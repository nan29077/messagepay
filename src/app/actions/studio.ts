'use server';

import { logger } from '@/lib/logger';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireCreator } from '@/server/auth';
import { newId } from '@/lib/id';
import { env } from '@/lib/env';
import { accountTail4, decrypt, encrypt, generateToken, isValidResident, maskName, maskSecret, normalizeResident, tokenHash } from '@/lib/crypto';
import { resolvePolicy } from '@/server/services/limits';
import { createSettlementRequest } from '@/server/services/settlement';
import { notifySuperAdmins } from '@/server/services/notifications';
import { formatWon } from '@/lib/money';
import { loadBannedWords } from '@/server/services/donation-flow';
import { THANKS_MT_MAX_LENGTH, THANKS_MT_VARIABLES } from '@/server/services/mt-templates';
import { bannedNeedle, filterContent } from '@/server/services/content-filter';
import { bankName } from '@/components/studio/banks';

/**
 * 가맹점 관리자(/studio) 서버 액션.
 *
 * 공통 규칙
 *  - 모든 액션은 requireCreator() 로 로그인/권한을 확인한다.
 *  - 대상 레코드의 creatorId 가 본인 것인지 반드시 재검증한 뒤에만 변경한다.
 *  - 입력은 zod 로 검증하고, 실패 사유는 사람이 읽을 수 있는 한국어로 반환한다.
 *  - 이용자 전화번호 원문/금융정보는 어떤 경로로도 반환하지 않는다.
 */

export interface StudioActionState {
  ok: boolean;
  message?: string;
  /** 1회만 노출하는 비밀값(API 키 등). 저장하지 않는다. */
  secret?: string;
  secretLabel?: string;
  secretHint?: string;
}

type Handler = (creatorId: string, userId: string) => Promise<StudioActionState>;

async function withCreator(fn: Handler): Promise<StudioActionState> {
  let creatorId: string;
  let userId: string;
  try {
    const user = await requireCreator();
    creatorId = user.creatorId;
    userId = user.id;
  } catch (e) {
    return { ok: false, message: (e as Error).message || '가맹점 권한이 필요합니다.' };
  }
  try {
    return await fn(creatorId, userId);
  } catch (e) {
    return { ok: false, message: userFacingError(e) };
  }
}

/**
 * 서비스 계층이 던진 한국어 안내문은 그대로 보여 주고,
 * Prisma/복호화 등 내부 오류 메시지는 로그로만 남기고 일반 문구로 바꾼다.
 */
function userFacingError(e: unknown): string {
  const message = (e as Error)?.message ?? '';
  const internal = !message || /prisma|invocation|decrypt|ECONNREFUSED|ETIMEDOUT/i.test(message) || !/[가-힣]/.test(message);
  if (internal) {
    logger.error('스튜디오 액션 처리 오류', { message });
    return '처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
  }
  return message;
}

function text(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === 'string' ? v.trim() : '';
}

function checked(formData: FormData, key: string): boolean {
  return formData.get(key) != null;
}

function parseAmount(input: string): bigint | null {
  const v = input.replace(/[,\s원]/g, '');
  if (!/^\d{1,12}$/.test(v)) return null;
  return BigInt(v);
}

// ===========================================================================
// 이용자 차단 / 해제
// ===========================================================================

/** 본인 채널과 실제로 연결된 이용자인지 확인한다. */
async function assertDonorLinked(creatorId: string, donorId: string) {
  const [donation, link] = await Promise.all([
    prisma.donation.findFirst({ where: { creatorId, donorId }, select: { id: true } }),
    prisma.donorCreatorLink.findUnique({
      where: { donorId_creatorId: { donorId, creatorId } },
      select: { id: true },
    }),
  ]);
  if (!donation && !link) throw new Error('본인 채널과 연결된 이용자가 아닙니다.');
}

export async function blockDonorAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withCreator(async (creatorId, userId) => {
    const parsed = z
      .object({ donorId: z.string().min(1), reason: z.string().max(200).optional() })
      .safeParse({ donorId: text(formData, 'donorId'), reason: text(formData, 'reason') || undefined });
    if (!parsed.success) return { ok: false, message: '차단할 이용자 정보가 올바르지 않습니다.' };

    const { donorId, reason } = parsed.data;
    await assertDonorLinked(creatorId, donorId);

    await prisma.blockedDonor.upsert({
      where: { creatorId_donorId: { creatorId, donorId } },
      create: { id: newId(), creatorId, donorId, reason: reason ?? null, blockedBy: userId },
      update: { reason: reason ?? null, blockedBy: userId },
    });

    revalidatePath('/studio/moderation');
    revalidatePath('/studio/donations');
    revalidatePath('/studio/messages');
    return { ok: true, message: '해당 이용자를 차단했습니다. 이후 문자는 결제로 접수되지 않습니다.' };
  });
}

export async function unblockDonorAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withCreator(async (creatorId) => {
    const donorId = text(formData, 'donorId');
    if (!donorId) return { ok: false, message: '이용자 정보가 올바르지 않습니다.' };

    const deleted = await prisma.blockedDonor.deleteMany({ where: { creatorId, donorId } });
    if (deleted.count === 0) return { ok: false, message: '차단 목록에 없는 이용자입니다.' };

    revalidatePath('/studio/moderation');
    return { ok: true, message: '차단을 해제했습니다.' };
  });
}

// ===========================================================================
// ===========================================================================

/**
 * 테스트 결제·구간 미리보기에 쓸 표시 문구를 만든다.
 *
 * 실제 결제는 결제 전에 반드시 filterContent 를 거쳐 저장된 결과만 송출한다.
 * 그런데 이 두 경로는 입력을 그대로 발행하고 있었고, 그 이벤트는 미리보기 전용 채널이 아니라
 * **실제 방송용 SSE 연결로도** 나간다. 방송 중에 테스트를 누르면 가맹점이 직접 등록한
 * 금칙어나 전화번호가 OBS 화면과 음성에 그대로 나오게 된다.
 *
 * 저장은 하지 않고 필터만 통과시켜, 실제 결제와 같은 기준으로 보이게 한다.
 */
async function previewSafeText(creatorId: string, donorName: string, message: string) {
  const rules = await loadBannedWords(creatorId);
  const name = filterContent(donorName, { bannedWords: rules, maxLength: 20 });
  const body = filterContent(message, { bannedWords: rules, maxLength: 200 });

  if (name.action === 'BLOCK' || body.action === 'BLOCK') {
    return { blocked: true as const };
  }
  return {
    blocked: false as const,
    donorName: name.clean,
    // filterContent 는 빈 문자열을 "(내용 없음)" 으로 바꾼다. 미리보기에서는 그냥 비워 둔다.
    message: body.clean === '(내용 없음)' ? '' : body.clean,
  };
}

// ===========================================================================
// ===========================================================================

// ===========================================================================
// 결제 설정
// ===========================================================================

export async function updateDonationSettingsAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withCreator(async (creatorId) => {
    const amount = parseAmount(text(formData, 'donationAmount'));
    if (amount === null) return { ok: false, message: '결제 금액은 숫자만 입력해 주세요.' };

    const [creator, policy] = await Promise.all([
      prisma.creatorProfile.findUnique({
        where: { id: creatorId },
        select: { minAmount: true, maxAmount: true },
      }),
      resolvePolicy(creatorId, null),
    ]);
    if (!creator) return { ok: false, message: '가맹점 정보를 찾을 수 없습니다.' };

    // 유효 범위 = 관리자 지정 가맹점 범위 ∩ 한도 정책 범위.
    // 정책 범위 밖 금액을 허용하면 결제 접수 시점에 AMOUNT_RANGE 로 전부 차단되므로 설정 단계에서 막는다.
    const effMin = creator.minAmount > policy.minAmount ? creator.minAmount : policy.minAmount;
    const effMax = creator.maxAmount < policy.maxAmount ? creator.maxAmount : policy.maxAmount;
    if (effMin > effMax) {
      return { ok: false, message: '관리자 설정과 한도 정책이 충돌해 설정할 수 있는 금액이 없습니다. 고객센터로 문의해 주세요.' };
    }
    if (amount < effMin || amount > effMax) {
      return {
        ok: false,
        message: `문자 1건당 결제 금액은 ${effMin.toString()}원 ~ ${effMax.toString()}원 사이에서만 설정할 수 있습니다.`,
      };
    }

    await prisma.creatorProfile.update({ where: { id: creatorId }, data: { donationAmount: amount } });
    revalidatePath('/studio/settings');
    revalidatePath('/studio');
    return { ok: true, message: '문자 1건당 결제 금액을 저장했습니다.' };
  });
}

// ===========================================================================
// 감사 문자 내용
// ===========================================================================

/** 감사 문자 본문에 허용하는 치환자 이름 */
const THANKS_TOKENS = THANKS_MT_VARIABLES.map((v) => v.token.slice(1, -1));

/**
 * 결제 감사 MT 문자 본문 저장.
 *
 * 검증 규칙
 *  - 200자 이내. 비우면 기본 문구로 돌아간다.
 *  - 링크(http/https/www) 금지. 감사 문자를 빌려 이용자를 외부로 유인하는 것을 막는다.
 *  - 정의되지 않은 치환자를 남기면 이용자에게 `{...}` 가 그대로 발송되므로 저장 단계에서 막는다.
 *  - 금칙어 필터는 이용자 메시지와 같은 규칙을 적용한다.
 */
export async function updateThanksMessageAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withCreator(async (creatorId) => {
    const raw = text(formData, 'thanksMtMessage');

    if (raw.length === 0) {
      await prisma.creatorProfile.update({ where: { id: creatorId }, data: { thanksMtMessage: null } });
      revalidatePath('/studio/settings');
      return { ok: true, message: '감사 문자를 기본 문구로 되돌렸습니다.' };
    }

    if (raw.length > THANKS_MT_MAX_LENGTH) {
      return { ok: false, message: `감사 문자는 ${THANKS_MT_MAX_LENGTH}자 이내로 입력해 주세요. (현재 ${raw.length}자)` };
    }
    if (/https?:\/\/|www\./i.test(raw)) {
      return { ok: false, message: '감사 문자에는 링크를 넣을 수 없습니다. 링크가 포함된 문자는 스팸으로 차단됩니다.' };
    }

    const unknown = [...raw.matchAll(/\{([^{}]*)\}/g)]
      .map((m) => m[1])
      .filter((name) => !THANKS_TOKENS.includes(name));
    if (unknown.length > 0) {
      return {
        ok: false,
        message: `사용할 수 없는 치환자입니다: {${unknown[0]}} — ${THANKS_MT_VARIABLES.map((v) => v.token).join(' ')} 만 사용할 수 있습니다.`,
      };
    }

    // 이용자에게 발송되는 문구이므로 결제 메시지와 같은 금칙어 기준을 적용한다.
    const rules = await loadBannedWords(creatorId);
    const filtered = filterContent(raw, { bannedWords: rules, maxLength: THANKS_MT_MAX_LENGTH });
    if (filtered.action === 'BLOCK') {
      return {
        ok: false,
        message: `운영정책에 어긋나는 표현이 있어 저장할 수 없습니다.${filtered.reasons.length ? ` (${filtered.reasons.join(', ')})` : ''}`,
      };
    }
    if (filtered.containsPersonalInfo) {
      return { ok: false, message: '전화번호·계좌번호 등 개인정보는 감사 문자에 넣을 수 없습니다.' };
    }

    await prisma.creatorProfile.update({ where: { id: creatorId }, data: { thanksMtMessage: raw } });
    revalidatePath('/studio/settings');
    return { ok: true, message: '감사 문자 내용을 저장했습니다. 다음 결제부터 적용됩니다.' };
  });
}

// ===========================================================================
// 금칙어
// ===========================================================================

const WORD_ACTIONS = ['BLOCK', 'MASK', 'FLAG'] as const;

export async function createBannedWordAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withCreator(async (creatorId) => {
    const parsed = z
      .object({ word: z.string().trim().min(1).max(40), action: z.enum(WORD_ACTIONS) })
      .safeParse({ word: text(formData, 'word'), action: text(formData, 'action') });
    if (!parsed.success) return { ok: false, message: '금칙어는 1~40자로 입력하고 처리 방식을 선택해 주세요.' };

    const word = parsed.data.word;
    // 공백·구두점처럼 비교에서 무시하는 문자만으로 된 단어는 금칙어 구실을 못 한다.
    // (예전 정규식 구현에서는 이런 단어가 서버를 멈추게 만드는 입력이기도 했다)
    if (!bannedNeedle(word)) {
      return { ok: false, message: '공백이나 기호(. _ - * ~ = + /)만으로는 금칙어를 만들 수 없습니다.' };
    }

    const exists = await prisma.bannedWord.findFirst({ where: { creatorId, word, scope: 'CREATOR' } });
    if (exists) return { ok: false, message: '이미 등록된 금칙어입니다.' };

    await prisma.bannedWord.create({
      data: { id: newId(), word, action: parsed.data.action, scope: 'CREATOR', creatorId, active: true },
    });

    revalidatePath('/studio/moderation');
    return { ok: true, message: `금칙어 "${word}"를 등록했습니다.` };
  });
}

export async function toggleBannedWordAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withCreator(async (creatorId) => {
    const id = text(formData, 'id');
    const row = await prisma.bannedWord.findUnique({ where: { id }, select: { creatorId: true, scope: true, active: true } });
    if (!row || row.creatorId !== creatorId || row.scope !== 'CREATOR') {
      return { ok: false, message: '본인이 등록한 금칙어만 변경할 수 있습니다.' };
    }

    await prisma.bannedWord.update({ where: { id }, data: { active: !row.active } });
    revalidatePath('/studio/moderation');
    return { ok: true, message: row.active ? '금칙어를 사용 중지했습니다.' : '금칙어를 다시 사용합니다.' };
  });
}

export async function deleteBannedWordAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withCreator(async (creatorId) => {
    const id = text(formData, 'id');
    const row = await prisma.bannedWord.findUnique({ where: { id }, select: { creatorId: true, scope: true } });
    if (!row || row.creatorId !== creatorId || row.scope !== 'CREATOR') {
      return { ok: false, message: '본인이 등록한 금칙어만 삭제할 수 있습니다.' };
    }

    await prisma.bannedWord.delete({ where: { id } });
    revalidatePath('/studio/moderation');
    return { ok: true, message: '금칙어를 삭제했습니다.' };
  });
}

/** 자주 쓰는 기본 금칙어 세트(비속어 위주). 마스킹으로 등록한다. */
const DEFAULT_BANNED_WORDS = [
  '씨발', '시발', '개새끼', '병신', '지랄', '좆', '존나', '썅', '엿먹어', '닥쳐',
  '창녀', '보지', '자지', '섹스', '느금마', '니미', '꺼져', '죽어', '새끼',
];

/**
 * 기본 금칙어 세트를 한 번에 추가한다.
 * 이미 등록된 단어는 건너뛴다. 등록 후 개별로 처리 방식·사용 여부를 조정할 수 있다.
 */
export async function addDefaultBannedWordsAction(
  _prev: StudioActionState,
  _formData: FormData,
): Promise<StudioActionState> {
  return withCreator(async (creatorId) => {
    const existing = new Set(
      (await prisma.bannedWord.findMany({ where: { creatorId, scope: 'CREATOR' }, select: { word: true } })).map((w) => w.word),
    );
    const toAdd = DEFAULT_BANNED_WORDS.filter((w) => !existing.has(w));
    if (toAdd.length === 0) return { ok: true, message: '기본 금칙어가 이미 모두 등록되어 있습니다.' };

    await prisma.bannedWord.createMany({
      data: toAdd.map((word) => ({ id: newId(), word, action: 'MASK' as const, scope: 'CREATOR' as const, creatorId, active: true })),
    });
    revalidatePath('/studio/moderation');
    return { ok: true, message: `기본 금칙어 ${toAdd.length}개를 마스킹으로 추가했습니다. 필요에 따라 차단으로 바꿀 수 있습니다.` };
  });
}

/**
 * 금칙어 미리보기 — 입력 문장에 내 금칙어/전역 금칙어를 적용한 결과를 돌려준다.
 * 실제 결제를 만들지 않고 필터 결과만 확인한다.
 */
export async function testBannedWordsAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withCreator(async (creatorId) => {
    const sample = text(formData, 'sample');
    if (!sample) return { ok: false, message: '테스트할 문장을 입력해 주세요.' };

    const rules = await loadBannedWords(creatorId);
    const result = filterContent(sample, { bannedWords: rules, maxLength: 200 });

    const verdict =
      result.action === 'BLOCK'
        ? '차단됨 (이 문장은 결제로 접수되지 않습니다)'
        : result.action === 'MASK'
          ? '마스킹 적용됨 (일부가 가려집니다)'
          : '통과 (그대로 노출됩니다)';

    return {
      ok: true,
      message: `[${verdict}] 노출 결과: "${result.clean}"${result.reasons.length ? ` · 적용: ${result.reasons.join(', ')}` : ''}`,
    };
  });
}

// ===========================================================================
// 정산
// ===========================================================================

export async function requestSettlementAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withCreator(async (creatorId) => {
    const amount = parseAmount(text(formData, 'amount'));
    if (amount === null || amount <= 0n) return { ok: false, message: '정산 요청 금액을 숫자로 입력해 주세요.' };

    const memo = text(formData, 'memo').slice(0, 200) || undefined;

    // 개인(사업소득 3.3% 원천징수) 가맹점은 신고용 주민등록번호가 필수다.
    const residentRaw = text(formData, 'resident');
    const agreed = checked(formData, 'residentAgree');
    // 마스킹만 전송되는 재사용 케이스(값에 * 포함)는 신규 입력으로 취급하지 않는다.
    const isNewResident = residentRaw && !residentRaw.includes('*');

    // 이미 등록해 둔(파기 전) 주민번호가 있으면 재입력 없이 진행할 수 있다.
    const prior = await prisma.settlementRequest.findFirst({
      where: { creatorId, residentEnc: { not: null } },
      orderBy: { requestedAt: 'desc' },
      select: { residentEnc: true },
    });

    let resident: string | null = null;
    if (isNewResident) {
      if (!agreed) return { ok: false, message: '주민등록번호 수집·이용에 동의해 주세요.' };
      const norm = normalizeResident(residentRaw);
      if (!norm) return { ok: false, message: '주민등록번호 13자리를 정확히 입력해 주세요.' };
      if (!isValidResident(norm)) return { ok: false, message: '주민등록번호가 올바르지 않습니다. 다시 확인해 주세요.' };
      resident = norm;
    } else if (prior?.residentEnc) {
      // 기존 등록분을 재사용한다.
      resident = decrypt(prior.residentEnc);
    } else {
      return {
        ok: false,
        message: '원천징수 신고를 위해 주민등록번호를 입력하고 수집·이용에 동의해 주세요.',
      };
    }

    const created = await createSettlementRequest(creatorId, amount, { memo, resident });

    // 최고관리자에게 알린다.
    // 요청은 /admin/settlements 목록에 뜨지만, 아무도 통보받지 못하면
    // 관리자가 화면을 열어보기 전까지 지급이 그대로 밀린다.
    // 알림 실패가 요청 접수 자체를 되돌리면 안 되므로 예외는 삼킨다.
    const profile = await prisma.creatorProfile.findUnique({
      where: { id: creatorId },
      select: { displayName: true, code: true },
    });
    await notifySuperAdmins({
      title: '새 정산 요청이 접수되었습니다',
      body: `${profile?.displayName ?? '가맹점'}(${profile?.code ?? creatorId}) · 요청금 ${formatWon(created.amount)} · 실지급 예정 ${formatWon(created.payoutAmount)}`,
      linkUrl: '/admin/settlements',
    }).catch(() => undefined);

    revalidatePath('/studio/settlement');
    revalidatePath('/studio');
    return {
      ok: true,
      message: `정산 요청을 접수했습니다. 요청금 ${created.amount.toString()}원, 원천징수 ${created.withholding.toString()}원, 실지급 예정 ${created.payoutAmount.toString()}원입니다.`,
    };
  });
}

export async function saveSettlementAccountAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withCreator(async (creatorId) => {
    const parsed = z
      .object({
        bankCode: z.string().min(2).max(4),
        account: z.string().regex(/^[0-9]{8,20}$/u, '계좌번호 형식이 올바르지 않습니다.'),
        holderName: z.string().trim().min(2).max(30),
      })
      .safeParse({
        bankCode: text(formData, 'bankCode'),
        account: text(formData, 'account').replace(/[-\s]/g, ''),
        holderName: text(formData, 'holderName'),
      });
    if (!parsed.success) {
      return { ok: false, message: '은행, 계좌번호(숫자 8~20자리), 예금주(2~30자)를 정확히 입력해 주세요.' };
    }

    const name = bankName(parsed.data.bankCode);
    if (!name) return { ok: false, message: '지원하지 않는 은행입니다.' };

    const data = {
      bankCode: parsed.data.bankCode,
      bankName: name,
      accountEnc: encrypt(parsed.data.account),
      accountTail4: accountTail4(parsed.data.account),
      holderNameEnc: encrypt(parsed.data.holderName),
      holderMasked: maskName(parsed.data.holderName),
      // 계좌 실명확인은 아직 mock 이다. 임의로 인증 성공 처리하지 않는다.
      verified: false,
      verifiedAt: null,
    };

    await prisma.settlementAccount.upsert({
      where: { creatorId },
      create: { id: newId(), creatorId, ...data },
      update: data,
    });

    revalidatePath('/studio/settlement/account');
    revalidatePath('/studio/settlement');
    return {
      ok: true,
      message: '정산 계좌를 저장했습니다. 예금주 실명확인은 통합 관리자 승인 후 완료됩니다.',
    };
  });
}

// ===========================================================================
// 프로필
// ===========================================================================

/** http(s) 주소 또는 사이트 내 경로(/로 시작)를 허용하는 이미지 주소 검증 */
const imageUrlSchema = z.union([
  z.literal(''),
  z.url(),
  z.string().regex(/^\/[^\s]*$/u, '이미지 주소는 http(s) 주소 또는 / 로 시작하는 경로여야 합니다.'),
]);

export async function updateCreatorProfileAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withCreator(async (creatorId) => {
    // 소개(description)는 결제 페이지 관리에서만 수정한다.
    // 여기서 함께 저장하면 프로필만 저장했을 때 결제 페이지 소개가 지워진다.
    const parsed = z
      .object({
        displayName: z.string().trim().min(1).max(30),
        channelName: z.string().trim().max(50),
        avatarUrl: imageUrlSchema,
      })
      .safeParse({
        displayName: text(formData, 'displayName'),
        channelName: text(formData, 'channelName'),
        avatarUrl: text(formData, 'avatarUrl'),
      });
    if (!parsed.success) {
      return {
        ok: false,
        message:
          '표시명(1~30자), 채널명(50자 이내)을 확인하고 아바타 주소는 http(s) 주소 또는 / 로 시작하는 경로로 입력해 주세요.',
      };
    }

    await prisma.creatorProfile.update({
      where: { id: creatorId },
      data: {
        displayName: parsed.data.displayName,
        channelName: parsed.data.channelName || null,
        avatarUrl: parsed.data.avatarUrl || null,
      },
    });

    revalidatePath('/studio/profile');
    revalidatePath('/studio');
    return { ok: true, message: '프로필을 저장했습니다.' };
  });
}

/**
 * 결제 페이지 설정 (배너 · 라이브 링크 · 방송중 스위치).
 * 라이브 링크는 방송마다 바뀌므로 언제든 수정할 수 있고,
 * 스위치를 켜면 결제 페이지 프로필에 두근두근 효과와 라이브중 배지가 표시된다.
 */
export async function updateDonationPageAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withCreator(async (creatorId) => {
    const bannerPreset = text(formData, 'bannerPreset');
    const parsed = z
      .object({
        bannerUrl: imageUrlSchema,
        description: z.string().trim().max(300),
      })
      .safeParse({
        bannerUrl: text(formData, 'bannerUrl'),
        description: text(formData, 'description'),
        // 예전 단일 필드(liveUrl)로 저장하던 폼과도 호환되게 받는다.
      });
    if (!parsed.success) {
      return {
        ok: false,
        message: '배너 주소는 http(s) 주소 또는 / 로 시작하는 경로, 소개는 300자 이내로 입력해 주세요.',
      };
    }

    // 기본 배너 프리셋을 골랐으면 프리셋을, '직접 입력'이면 입력한 주소를 사용한다.
    if (bannerPreset && bannerPreset !== 'custom' && !/^\/banners\/[a-z0-9-]+\.png$/.test(bannerPreset)) {
      return { ok: false, message: '배너 선택 값이 올바르지 않습니다.' };
    }
    const bannerUrl =
      bannerPreset === 'custom' ? parsed.data.bannerUrl || null : bannerPreset ? bannerPreset : null;

    await prisma.creatorProfile.update({
      where: { id: creatorId },
      data: {
        bannerUrl,
        description: parsed.data.description || null,
      },
    });

    revalidatePath('/studio/settings');
    revalidatePath('/studio/profile');
    revalidatePath('/studio');
    return {
      ok: true,
      message: '결제 페이지 설정을 저장했습니다.',
    };
  });
}
