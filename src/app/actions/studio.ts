'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireCreator } from '@/server/auth';
import { newId } from '@/lib/id';
import { env } from '@/lib/env';
import { accountTail4, decrypt, encrypt, generateToken, maskName, maskSecret, tokenHash } from '@/lib/crypto';
import { sendTestOverlay } from '@/server/services/broadcast-dispatch';
import { resolvePolicy } from '@/server/services/limits';
import { createSettlementRequest } from '@/server/services/settlement';
import { getYouTubeAdapter } from '@/server/adapters/youtube';
import { getStreamAdapter } from '@/server/adapters/stream';
import { bankName } from '@/components/studio/banks';

/**
 * 크리에이터 관리자(/studio) 서버 액션.
 *
 * 공통 규칙
 *  - 모든 액션은 requireCreator() 로 로그인/권한을 확인한다.
 *  - 대상 레코드의 creatorId 가 본인 것인지 반드시 재검증한 뒤에만 변경한다.
 *  - 입력은 zod 로 검증하고, 실패 사유는 사람이 읽을 수 있는 한국어로 반환한다.
 *  - 후원자 전화번호 원문/금융정보는 어떤 경로로도 반환하지 않는다.
 */

export interface StudioActionState {
  ok: boolean;
  message?: string;
  /** 1회만 노출하는 비밀값(오버레이 URL, 스트림 키). 저장하지 않는다. */
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
    return { ok: false, message: (e as Error).message || '크리에이터 권한이 필요합니다.' };
  }
  try {
    return await fn(creatorId, userId);
  } catch (e) {
    return { ok: false, message: (e as Error).message || '처리 중 오류가 발생했습니다.' };
  }
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
// 후원자 차단 / 해제
// ===========================================================================

/** 본인 채널과 실제로 연결된 후원자인지 확인한다. */
async function assertDonorLinked(creatorId: string, donorId: string) {
  const [donation, link] = await Promise.all([
    prisma.donation.findFirst({ where: { creatorId, donorId }, select: { id: true } }),
    prisma.donorCreatorLink.findUnique({
      where: { donorId_creatorId: { donorId, creatorId } },
      select: { id: true },
    }),
  ]);
  if (!donation && !link) throw new Error('본인 채널과 연결된 후원자가 아닙니다.');
}

export async function blockDonorAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withCreator(async (creatorId, userId) => {
    const parsed = z
      .object({ donorId: z.string().min(1), reason: z.string().max(200).optional() })
      .safeParse({ donorId: text(formData, 'donorId'), reason: text(formData, 'reason') || undefined });
    if (!parsed.success) return { ok: false, message: '차단할 후원자 정보가 올바르지 않습니다.' };

    const { donorId, reason } = parsed.data;
    await assertDonorLinked(creatorId, donorId);

    await prisma.blockedDonor.upsert({
      where: { creatorId_donorId: { creatorId, donorId } },
      create: { id: newId(), creatorId, donorId, reason: reason ?? null, blockedBy: userId },
      update: { reason: reason ?? null, blockedBy: userId },
    });
    await prisma.donorCreatorLink.updateMany({
      where: { creatorId, donorId },
      data: { blockedAt: new Date() },
    });

    revalidatePath('/studio/moderation');
    revalidatePath('/studio/donations');
    revalidatePath('/studio/messages');
    return { ok: true, message: '해당 후원자를 차단했습니다. 이후 문자는 후원으로 접수되지 않습니다.' };
  });
}

export async function unblockDonorAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withCreator(async (creatorId) => {
    const donorId = text(formData, 'donorId');
    if (!donorId) return { ok: false, message: '후원자 정보가 올바르지 않습니다.' };

    const deleted = await prisma.blockedDonor.deleteMany({ where: { creatorId, donorId } });
    if (deleted.count === 0) return { ok: false, message: '차단 목록에 없는 후원자입니다.' };

    await prisma.donorCreatorLink.updateMany({ where: { creatorId, donorId }, data: { blockedAt: null } });
    revalidatePath('/studio/moderation');
    return { ok: true, message: '차단을 해제했습니다.' };
  });
}

// ===========================================================================
// 후원 상세 - 오버레이 테스트 재생
// ===========================================================================

/**
 * 후원 내용을 오버레이에 다시 띄운다.
 * 실제 송출 파이프라인(dispatchBroadcast)은 후원 상태를 다시 기록하므로 사용하지 않고,
 * 동일한 내용을 테스트 이벤트로만 재생한다.
 */
export async function replayOverlayTestAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withCreator(async (creatorId) => {
    const donationId = text(formData, 'donationId');
    if (!donationId) return { ok: false, message: '후원 정보가 올바르지 않습니다.' };

    const donation = await prisma.donation.findFirst({
      where: { id: donationId, creatorId },
      select: { amount: true, displayName: true, message: true, anonymous: true },
    });
    if (!donation) return { ok: false, message: '본인 채널의 후원 내역이 아닙니다.' };

    await sendTestOverlay(creatorId, {
      donorName: donation.anonymous ? '익명의 후원자' : donation.displayName,
      amount: donation.amount,
      message: donation.message,
    });

    return {
      ok: true,
      message: '오버레이에 테스트 재생을 보냈습니다. 실제 재송출이 아니며 후원 상태와 정산에는 반영되지 않습니다.',
    };
  });
}

// ===========================================================================
// 유튜브
// ===========================================================================

export async function disconnectYouTubeAction(
  _prev: StudioActionState,
  _formData: FormData,
): Promise<StudioActionState> {
  return withCreator(async (creatorId) => {
    const updated = await prisma.youTubeConnection.updateMany({
      where: { creatorId },
      data: { status: 'REVOKED', lastError: null, lastCheckedAt: new Date() },
    });
    if (updated.count === 0) return { ok: false, message: '연결된 유튜브 채널이 없습니다.' };
    revalidatePath('/studio/youtube');
    revalidatePath('/studio');
    return { ok: true, message: '유튜브 채널 연결을 해제했습니다. 저장된 토큰은 더 이상 사용되지 않습니다.' };
  });
}

export async function refreshYouTubeBroadcastAction(
  _prev: StudioActionState,
  _formData: FormData,
): Promise<StudioActionState> {
  return withCreator(async (creatorId) => {
    const conn = await prisma.youTubeConnection.findUnique({ where: { creatorId } });
    if (!conn) return { ok: false, message: '유튜브 채널이 연결되어 있지 않습니다.' };
    if (conn.status !== 'CONNECTED') return { ok: false, message: '유튜브 연결 상태가 정상이 아닙니다. 채널을 다시 연결해 주세요.' };

    const adapter = getYouTubeAdapter();
    let accessToken = decrypt(conn.accessTokenEnc);

    if (conn.expiresAt.getTime() < Date.now() + 60_000) {
      const refreshed = await adapter.refresh(decrypt(conn.refreshTokenEnc));
      if (!refreshed.ok || !refreshed.data) {
        await prisma.youTubeConnection.update({
          where: { id: conn.id },
          data: { status: 'EXPIRED', lastError: refreshed.message ?? '토큰 갱신 실패' },
        });
        revalidatePath('/studio/youtube');
        return { ok: false, message: '액세스 토큰 갱신에 실패했습니다. 채널을 다시 연결해 주세요.' };
      }
      accessToken = refreshed.data.accessToken;
      await prisma.youTubeConnection.update({
        where: { id: conn.id },
        data: {
          accessTokenEnc: encrypt(refreshed.data.accessToken),
          expiresAt: refreshed.data.expiresAt,
          status: 'CONNECTED',
          lastError: null,
        },
      });
    }

    const live = await adapter.findActiveBroadcast(accessToken);
    if (!live.ok) {
      await prisma.youTubeConnection.update({
        where: { id: conn.id },
        data: { lastError: live.message ?? '라이브 방송 조회 실패', lastCheckedAt: new Date() },
      });
      revalidatePath('/studio/youtube');
      return { ok: false, message: `라이브 방송 조회에 실패했습니다. ${live.message ?? ''}`.trim() };
    }

    await prisma.youTubeConnection.update({
      where: { id: conn.id },
      data: { lastCheckedAt: new Date(), lastError: null },
    });

    if (!live.data) {
      revalidatePath('/studio/youtube');
      return { ok: true, message: '현재 진행 중인 라이브 방송이 없습니다.' };
    }

    await prisma.youTubeBroadcast.upsert({
      where: { creatorId_broadcastId: { creatorId, broadcastId: live.data.broadcastId } },
      create: {
        id: newId(),
        creatorId,
        broadcastId: live.data.broadcastId,
        liveChatId: live.data.liveChatId,
        title: live.data.title,
        lifeCycle: live.data.lifeCycleStatus,
        chatEnabled: live.data.chatEnabled,
        startedAt: live.data.startedAt ?? null,
      },
      update: {
        liveChatId: live.data.liveChatId,
        title: live.data.title,
        lifeCycle: live.data.lifeCycleStatus,
        chatEnabled: live.data.chatEnabled,
        detectedAt: new Date(),
      },
    });

    revalidatePath('/studio/youtube');
    return {
      ok: true,
      message: `라이브 방송을 확인했습니다. 방송 ID ${live.data.broadcastId}${live.data.liveChatId ? '' : ' (라이브 채팅 ID 없음)'}`,
    };
  });
}

// ===========================================================================
// 오버레이
// ===========================================================================

const POSITIONS = [
  'TOP_LEFT',
  'TOP_CENTER',
  'TOP_RIGHT',
  'BOTTOM_LEFT',
  'BOTTOM_CENTER',
  'BOTTOM_RIGHT',
] as const;

/**
 * 브라우저 소스 URL 재발급.
 * tokenHash 만 저장하므로 원문 복구가 불가능하다. 발급 직후 1회만 전체 URL 을 반환한다.
 */
export async function regenerateOverlayTokenAction(
  _prev: StudioActionState,
  _formData: FormData,
): Promise<StudioActionState> {
  return withCreator(async (creatorId) => {
    const token = generateToken(24);
    const data = { tokenHash: tokenHash(token), tokenMasked: maskSecret(token) };

    await prisma.overlaySetting.upsert({
      where: { creatorId },
      create: { id: newId(), creatorId, ...data },
      update: data,
    });

    revalidatePath('/studio/overlay');
    return {
      ok: true,
      message: '새 브라우저 소스 URL을 발급했습니다. 기존 URL은 즉시 무효화되었습니다.',
      secret: `${env.baseUrl}/overlay/${creatorId}?token=${token}`,
      secretLabel: '브라우저 소스 URL',
      secretHint: '이 값은 지금 한 번만 표시됩니다. 화면을 벗어나면 다시 확인할 수 없습니다.',
    };
  });
}

export async function updateOverlaySettingAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withCreator(async (creatorId) => {
    const parsed = z
      .object({
        maxMessageLen: z.coerce.number().int().min(10).max(200),
        durationMs: z.coerce.number().int().min(2000).max(30000),
        position: z.enum(POSITIONS),
        theme: z.string().min(1).max(30),
        stickerSet: z.string().min(1).max(30),
      })
      .safeParse({
        maxMessageLen: text(formData, 'maxMessageLen'),
        durationMs: text(formData, 'durationMs'),
        position: text(formData, 'position'),
        theme: text(formData, 'theme'),
        stickerSet: text(formData, 'stickerSet'),
      });
    if (!parsed.success) {
      return { ok: false, message: '입력값을 확인해 주세요. 최대 글자 수는 10~200자, 표시 시간은 2000~30000ms 입니다.' };
    }

    const existing = await prisma.overlaySetting.findUnique({ where: { creatorId }, select: { id: true } });
    if (!existing) {
      return { ok: false, message: '오버레이 설정이 없습니다. 먼저 브라우저 소스 URL을 발급해 주세요.' };
    }

    await prisma.overlaySetting.update({
      where: { creatorId },
      data: {
        enabled: checked(formData, 'enabled'),
        showAmount: checked(formData, 'showAmount'),
        showMessage: checked(formData, 'showMessage'),
        anonymize: checked(formData, 'anonymize'),
        maxMessageLen: parsed.data.maxMessageLen,
        durationMs: parsed.data.durationMs,
        position: parsed.data.position,
        theme: parsed.data.theme,
        stickerSet: parsed.data.stickerSet,
      },
    });

    revalidatePath('/studio/overlay');
    return { ok: true, message: '오버레이 설정을 저장했습니다.' };
  });
}

export async function testOverlayAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withCreator(async (creatorId) => {
    const donorName = text(formData, 'donorName') || '테스트 후원자';
    const message = text(formData, 'message').slice(0, 200);
    const amount = parseAmount(text(formData, 'amount'));

    if (donorName.length > 20) return { ok: false, message: '표시명은 20자 이내로 입력해 주세요.' };
    if (amount === null) return { ok: false, message: '금액은 숫자만 입력해 주세요.' };
    if (amount < 100n || amount > 1_000_000n) return { ok: false, message: '테스트 금액은 100원 ~ 1,000,000원 사이로 입력해 주세요.' };

    await sendTestOverlay(creatorId, { donorName, amount, message });
    return { ok: true, message: '테스트 후원을 전송했습니다. 실제 결제와 정산에는 반영되지 않습니다.' };
  });
}

// ===========================================================================
// 자체 방송 스트림 키
// ===========================================================================

export async function reissueStreamKeyAction(
  _prev: StudioActionState,
  _formData: FormData,
): Promise<StudioActionState> {
  return withCreator(async (creatorId) => {
    const adapter = getStreamAdapter();
    const issued = await adapter.issueKey(creatorId);
    if (!issued.ok || !issued.data) {
      return { ok: false, message: issued.message ?? '스트림 키 발급에 실패했습니다.' };
    }

    const channel = await prisma.streamChannel.upsert({
      where: { creatorId },
      create: {
        id: newId(),
        creatorId,
        ingestUrl: issued.data.ingestUrl,
        playbackUrl: issued.data.playbackUrl,
      },
      update: { ingestUrl: issued.data.ingestUrl, playbackUrl: issued.data.playbackUrl },
    });

    await prisma.streamKey.updateMany({
      where: { channelId: channel.id, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    await prisma.streamKey.create({
      data: {
        id: newId(),
        channelId: channel.id,
        keyHash: tokenHash(issued.data.key),
        keyMasked: issued.data.keyMasked,
      },
    });

    revalidatePath('/studio/stream');
    return {
      ok: true,
      message: '새 스트림 키를 발급했습니다. 기존 키는 즉시 무효화되었습니다.',
      secret: issued.data.key,
      secretLabel: '스트림 키',
      secretHint: '이 값은 지금 한 번만 표시됩니다. 방송 프로그램에 즉시 등록해 주세요.',
    };
  });
}

// ===========================================================================
// 후원 설정
// ===========================================================================

export async function updateDonationSettingsAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withCreator(async (creatorId) => {
    const amount = parseAmount(text(formData, 'donationAmount'));
    if (amount === null) return { ok: false, message: '후원금은 숫자만 입력해 주세요.' };

    const [creator, policy] = await Promise.all([
      prisma.creatorProfile.findUnique({
        where: { id: creatorId },
        select: { minAmount: true, maxAmount: true },
      }),
      resolvePolicy(creatorId, null),
    ]);
    if (!creator) return { ok: false, message: '크리에이터 정보를 찾을 수 없습니다.' };

    // 유효 범위 = 관리자 지정 크리에이터 범위 ∩ 한도 정책 범위.
    // 정책 범위 밖 금액을 허용하면 후원 접수 시점에 AMOUNT_RANGE 로 전부 차단되므로 설정 단계에서 막는다.
    const effMin = creator.minAmount > policy.minAmount ? creator.minAmount : policy.minAmount;
    const effMax = creator.maxAmount < policy.maxAmount ? creator.maxAmount : policy.maxAmount;
    if (effMin > effMax) {
      return { ok: false, message: '관리자 설정과 한도 정책이 충돌해 설정할 수 있는 금액이 없습니다. 고객센터로 문의해 주세요.' };
    }
    if (amount < effMin || amount > effMax) {
      return {
        ok: false,
        message: `문자 1건당 후원금은 ${effMin.toString()}원 ~ ${effMax.toString()}원 사이에서만 설정할 수 있습니다.`,
      };
    }

    await prisma.creatorProfile.update({ where: { id: creatorId }, data: { donationAmount: amount } });
    revalidatePath('/studio/settings');
    revalidatePath('/studio');
    return { ok: true, message: '문자 1건당 후원금을 저장했습니다.' };
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
    const created = await createSettlementRequest(creatorId, amount, memo);

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

type LivePlatform = 'YOUTUBE' | 'INSTAGRAM' | 'TIKTOK';

function isPlatformUrl(url: string, platform: LivePlatform): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (platform === 'YOUTUBE') return /(^|\.)youtube\.com$/.test(u.hostname) || u.hostname === 'youtu.be';
    if (platform === 'INSTAGRAM') return /(^|\.)instagram\.com$/.test(u.hostname);
    return /(^|\.)tiktok\.com$/.test(u.hostname);
  } catch {
    return false;
  }
}

export async function updateCreatorProfileAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withCreator(async (creatorId) => {
    const parsed = z
      .object({
        displayName: z.string().trim().min(1).max(30),
        channelName: z.string().trim().max(50),
        description: z.string().trim().max(300),
        avatarUrl: imageUrlSchema,
      })
      .safeParse({
        displayName: text(formData, 'displayName'),
        channelName: text(formData, 'channelName'),
        description: text(formData, 'description'),
        avatarUrl: text(formData, 'avatarUrl'),
      });
    if (!parsed.success) {
      return {
        ok: false,
        message:
          '표시명(1~30자), 채널명(50자 이내), 소개(300자 이내)를 확인하고 아바타 주소는 http(s) 주소 또는 / 로 시작하는 경로로 입력해 주세요.',
      };
    }

    await prisma.creatorProfile.update({
      where: { id: creatorId },
      data: {
        displayName: parsed.data.displayName,
        channelName: parsed.data.channelName || null,
        description: parsed.data.description || null,
        avatarUrl: parsed.data.avatarUrl || null,
      },
    });

    revalidatePath('/studio/profile');
    revalidatePath('/studio');
    return { ok: true, message: '프로필을 저장했습니다.' };
  });
}

/**
 * 후원 페이지 설정 (배너 · 라이브 링크 · 방송중 스위치).
 * 라이브 링크는 방송마다 바뀌므로 언제든 수정할 수 있고,
 * 스위치를 켜면 후원 페이지 프로필에 두근두근 효과와 라이브중 배지가 표시된다.
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
        youtubeLiveUrl: z.string().trim().max(300),
        instagramLiveUrl: z.string().trim().max(300),
        tiktokLiveUrl: z.string().trim().max(300),
        livePlatform: z.enum(['YOUTUBE', 'INSTAGRAM', 'TIKTOK']),
      })
      .safeParse({
        bannerUrl: text(formData, 'bannerUrl'),
        description: text(formData, 'description'),
        youtubeLiveUrl: text(formData, 'youtubeLiveUrl'),
        instagramLiveUrl: text(formData, 'instagramLiveUrl'),
        tiktokLiveUrl: text(formData, 'tiktokLiveUrl'),
        livePlatform: text(formData, 'livePlatform') || 'YOUTUBE',
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

    const { youtubeLiveUrl, instagramLiveUrl, tiktokLiveUrl, livePlatform } = parsed.data;
    const links: Record<LivePlatform, string> = {
      YOUTUBE: youtubeLiveUrl,
      INSTAGRAM: instagramLiveUrl,
      TIKTOK: tiktokLiveUrl,
    };
    const labels: Record<LivePlatform, string> = { YOUTUBE: '유튜브', INSTAGRAM: '인스타그램', TIKTOK: '틱톡' };
    for (const platform of Object.keys(links) as LivePlatform[]) {
      if (links[platform] && !isPlatformUrl(links[platform], platform)) {
        return { ok: false, message: `${labels[platform]} 주소 형식을 확인해 주세요.` };
      }
    }

    const liveOn = checked(formData, 'liveOn');
    const activeLiveUrl = links[livePlatform];
    if (liveOn && !activeLiveUrl) {
      return { ok: false, message: `방송중 스위치를 켜려면 선택한 ${labels[livePlatform]} 라이브 주소를 입력해 주세요.` };
    }

    await prisma.creatorProfile.update({
      where: { id: creatorId },
      data: {
        bannerUrl,
        description: parsed.data.description || null,
        liveOn,
        livePlatform,
        youtubeLiveUrl: youtubeLiveUrl || null,
        instagramLiveUrl: instagramLiveUrl || null,
        tiktokLiveUrl: tiktokLiveUrl || null,
        // 구버전 화면 및 외부 연동 호환용 현재 활성 주소
        liveUrl: activeLiveUrl || null,
      },
    });

    revalidatePath('/studio/settings');
    revalidatePath('/studio/profile');
    revalidatePath('/studio');
    return {
      ok: true,
      message: liveOn
        ? '후원샵 설정을 저장했습니다. 후원샵에 온에어 표시가 켜졌습니다.'
        : '후원샵 설정을 저장했습니다.',
    };
  });
}
