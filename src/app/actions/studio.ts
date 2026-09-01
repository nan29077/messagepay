'use server';

import { logger } from '@/lib/logger';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireMerchant } from '@/server/auth';
import { newId } from '@/lib/id';
import { env } from '@/lib/env';
import { accountTail4, decrypt, encrypt, generateToken, isValidResident, maskName, maskResident, maskSecret, normalizeResident, tokenHash } from '@/lib/crypto';
import { resolvePolicy } from '@/server/services/limits';
import { createSettlementRequest } from '@/server/services/settlement';
import { issueMerchantApiKey } from '@/server/services/partner-auth';
import { notifySuperAdmins } from '@/server/services/notifications';
import { formatWon } from '@/lib/money';
import { loadBannedWords } from '@/server/services/charge-flow';
import { THANKS_MT_MAX_LENGTH, THANKS_MT_VARIABLES, MO_GUIDE_MAX_LENGTH, MO_GUIDE_VARIABLES } from '@/server/services/mt-templates';
import { bannedNeedle, filterContent } from '@/server/services/content-filter';
import { parseOptionLines } from '@/server/services/products';
import { bankName } from '@/components/studio/banks';
import { Prisma } from '@/generated/prisma/client';
import type { DigitalProductType, ProductKind } from '@/generated/prisma/enums';
import { PAID_STATUSES } from '@/components/studio/shared';

/**
 * 가맹점 관리자(/studio) 서버 액션.
 *
 * 공통 규칙
 *  - 모든 액션은 requireMerchant() 로 로그인/권한을 확인한다.
 *  - 대상 레코드의 merchantId 가 본인 것인지 반드시 재검증한 뒤에만 변경한다.
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

type Handler = (merchantId: string, userId: string) => Promise<StudioActionState>;

async function withMerchant(fn: Handler): Promise<StudioActionState> {
  let merchantId: string;
  let userId: string;
  try {
    const user = await requireMerchant();
    merchantId = user.merchantId;
    userId = user.id;
  } catch (e) {
    return { ok: false, message: (e as Error).message || '가맹점 권한이 필요합니다.' };
  }
  try {
    return await fn(merchantId, userId);
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

/** 가맹점 1곳이 등록할 수 있는 충전 상품 수 상한 (선택 화면이 감당하는 개수) */
const MAX_CHARGE_PRODUCTS = 12;

function parseAmount(input: string): bigint | null {
  const v = input.replace(/[,\s원]/g, '');
  if (!/^\d{1,12}$/.test(v)) return null;
  return BigInt(v);
}

// ===========================================================================
// 이용자 차단 / 해제
// ===========================================================================

/** 본인 채널과 실제로 연결된 이용자인지 확인한다. */
async function assertPayerLinked(merchantId: string, payerId: string) {
  const [charge, link] = await Promise.all([
    prisma.charge.findFirst({ where: { merchantId, payerId }, select: { id: true } }),
    prisma.payerMerchantLink.findUnique({
      where: { payerId_merchantId: { payerId, merchantId } },
      select: { id: true },
    }),
  ]);
  if (!charge && !link) throw new Error('본인 채널과 연결된 이용자가 아닙니다.');
}

export async function blockPayerAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withMerchant(async (merchantId, userId) => {
    const parsed = z
      .object({ payerId: z.string().min(1), reason: z.string().max(200).optional() })
      .safeParse({ payerId: text(formData, 'payerId'), reason: text(formData, 'reason') || undefined });
    if (!parsed.success) return { ok: false, message: '차단할 이용자 정보가 올바르지 않습니다.' };

    const { payerId, reason } = parsed.data;
    await assertPayerLinked(merchantId, payerId);

    await prisma.blockedPayer.upsert({
      where: { merchantId_payerId: { merchantId, payerId } },
      create: { id: newId(), merchantId, payerId, reason: reason ?? null, blockedBy: userId },
      update: { reason: reason ?? null, blockedBy: userId },
    });

    revalidatePath('/studio/moderation');
    revalidatePath('/studio/charges');
    revalidatePath('/studio/messages');
    return { ok: true, message: '해당 이용자를 차단했습니다. 이후 문자는 결제로 접수되지 않습니다.' };
  });
}

export async function unblockPayerAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withMerchant(async (merchantId) => {
    const payerId = text(formData, 'payerId');
    if (!payerId) return { ok: false, message: '이용자 정보가 올바르지 않습니다.' };

    const deleted = await prisma.blockedPayer.deleteMany({ where: { merchantId, payerId } });
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
 * 실제 결제는 저장 전에 반드시 filterContent 를 거친다.
 * 그런데 이 두 경로는 입력을 그대로 발행하고 있었고, 그 이벤트는 미리보기 전용 채널이 아니라
 * 미리보기 경로는 그 필터를 건너뛰면 가맹점이 직접 등록한
 * 금칙어나 전화번호가 미리보기에 그대로 나오게 된다.
 *
 * 저장은 하지 않고 필터만 통과시켜, 실제 결제와 같은 기준으로 보이게 한다.
 */
async function previewSafeText(merchantId: string, payerName: string, message: string) {
  const rules = await loadBannedWords(merchantId);
  const name = filterContent(payerName, { bannedWords: rules, maxLength: 20 });
  const body = filterContent(message, { bannedWords: rules, maxLength: 200 });

  if (name.action === 'BLOCK' || body.action === 'BLOCK') {
    return { blocked: true as const };
  }
  return {
    blocked: false as const,
    payerName: name.clean,
    // filterContent 는 빈 문자열을 "(내용 없음)" 으로 바꾼다. 미리보기에서는 그냥 비워 둔다.
    message: body.clean === '(내용 없음)' ? '' : body.clean,
  };
}

// ===========================================================================
// ===========================================================================

// ===========================================================================
// 포인트 지급 처리
// ===========================================================================

/**
 * 포인트 지급은 가맹점이 자기 서비스에서 한다.
 * 문자페이는 "이 결제 건을 처리했는가" 만 기록해, 빠뜨린 건과 환불 회수 대상을 알 수 있게 한다.
 *
 * 지급 대상은 결제가 완료된 건뿐이다. 결제되지 않은 건을 지급 완료로 표시하면
 * 가맹점이 받지도 않은 돈에 포인트를 주게 된다.
 */
const POINT_PAYABLE_STATUSES = PAID_STATUSES;

/** 한 번에 처리할 수 있는 건수 상한. 화면에서 실수로 전체를 누르는 사고를 막는다. */
const POINT_BULK_MAX = 200;

function chargeIdsOf(formData: FormData): string[] {
  const raw = formData.getAll('chargeIds').map((v) => String(v).trim()).filter(Boolean);
  return [...new Set(raw)];
}

/** 선택한 결제 건을 지급 완료로 표시한다(일괄). */
export async function markPointsGivenAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withMerchant(async (merchantId, userId) => {
    const ids = chargeIdsOf(formData);
    if (ids.length === 0) return { ok: false, message: '처리할 결제 건을 선택해 주세요.' };
    if (ids.length > POINT_BULK_MAX) {
      return { ok: false, message: `한 번에 최대 ${POINT_BULK_MAX}건까지 처리할 수 있습니다.` };
    }
    const note = text(formData, 'note').slice(0, 100);

    // 내 가맹점의, 결제가 완료된, 아직 지급하지 않은 건만 바꾼다.
    const result = await prisma.charge.updateMany({
      where: {
        id: { in: ids },
        merchantId,
        status: { in: POINT_PAYABLE_STATUSES },
        pointStatus: { in: ['PENDING', 'FAILED'] },
      },
      data: {
        pointStatus: 'SENT',
        pointGivenAt: new Date(),
        pointBy: userId,
        pointNote: note || null,
      },
    });

    revalidatePath('/studio/charges');
    revalidatePath('/studio');
    if (result.count === 0) {
      return { ok: false, message: '처리할 수 있는 건이 없습니다. 이미 처리됐거나 결제가 완료되지 않은 건입니다.' };
    }
    return { ok: true, message: `${result.count}건을 지급 완료로 표시했습니다.` };
  });
}

/** 지급을 보류한다(사유를 남긴다). */
export async function markPointsHeldAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withMerchant(async (merchantId, userId) => {
    const ids = chargeIdsOf(formData);
    const note = text(formData, 'note').slice(0, 100);
    if (ids.length === 0) return { ok: false, message: '처리할 결제 건을 선택해 주세요.' };
    if (!note) return { ok: false, message: '보류 사유를 입력해 주세요.' };

    const result = await prisma.charge.updateMany({
      where: { id: { in: ids }, merchantId, pointStatus: { in: ['PENDING', 'SENT'] } },
      data: { pointStatus: 'FAILED', pointNote: note, pointBy: userId },
    });

    revalidatePath('/studio/charges');
    if (result.count === 0) return { ok: false, message: '처리할 수 있는 건이 없습니다.' };
    return { ok: true, message: `${result.count}건을 보류로 표시했습니다.` };
  });
}

/** 지급 완료 표시를 되돌린다(잘못 눌렀을 때). */
export async function undoPointsGivenAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withMerchant(async (merchantId, userId) => {
    const ids = chargeIdsOf(formData);
    if (ids.length === 0) return { ok: false, message: '처리할 결제 건을 선택해 주세요.' };

    const result = await prisma.charge.updateMany({
      where: { id: { in: ids }, merchantId, pointStatus: 'SENT' },
      data: { pointStatus: 'PENDING', pointGivenAt: null, pointBy: userId, pointNote: null },
    });

    revalidatePath('/studio/charges');
    if (result.count === 0) return { ok: false, message: '되돌릴 수 있는 건이 없습니다.' };
    return { ok: true, message: `${result.count}건을 지급 대기로 되돌렸습니다.` };
  });
}

// ===========================================================================
// 충전 상품 · 결제 설정
// ===========================================================================

/**
 * 가맹점이 고를 수 있는 유효 금액 범위.
 * 관리자 지정 가맹점 범위 ∩ 한도 정책 범위 — 여기를 벗어난 금액은 결제 접수 시 AMOUNT_RANGE 로
 * 전부 실패하므로, 상품을 만드는 단계에서 미리 막는다.
 */
async function effectiveAmountRange(merchantId: string) {
  const [merchant, policy] = await Promise.all([
    prisma.merchantProfile.findUnique({
      where: { id: merchantId },
      select: { minAmount: true, maxAmount: true },
    }),
    resolvePolicy(merchantId, null),
  ]);
  if (!merchant) return null;
  const min = merchant.minAmount > policy.minAmount ? merchant.minAmount : policy.minAmount;
  const max = merchant.maxAmount < policy.maxAmount ? merchant.maxAmount : policy.maxAmount;
  return { min, max };
}

/** 직접 입력 허용 여부. 끄면 등록된 충전 상품만 고를 수 있다. */
export async function updateChargeSettingsAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withMerchant(async (merchantId) => {
    const allowCustomAmount = checked(formData, 'allowCustomAmount');

    if (!allowCustomAmount) {
      // 직접 입력을 끄는데 고를 상품이 하나도 없으면 결제가 아예 불가능해진다.
      const usable = await prisma.chargeProduct.count({
        where: { merchantId, active: true, archivedAt: null },
      });
      if (usable === 0) {
        return {
          ok: false,
          message: '직접 입력을 끄려면 사용 중인 충전 상품이 최소 1개 있어야 합니다.',
        };
      }
    }

    await prisma.merchantProfile.update({ where: { id: merchantId }, data: { allowCustomAmount } });
    revalidatePath('/studio/settings');
    revalidatePath('/studio');
    return {
      ok: true,
      message: allowCustomAmount ? '직접 입력을 허용했습니다.' : '직접 입력을 끄고 등록된 상품만 노출합니다.',
    };
  });
}

// ---------------------------------------------------------------------------
// 상품 (비실물 · 실물)
// ---------------------------------------------------------------------------

/**
 * 폼에서 상품 값을 읽어 검증한다.
 *
 * 비실물(포인트·상품권·이용권)과 실물(배송비·재고·옵션)은 필요한 값이 다르다.
 * 두 경로가 각각 검증하면 규칙이 갈라지므로 여기 한 곳에서만 판단한다.
 */
async function parseProductForm(
  merchantId: string,
  formData: FormData,
): Promise<{ ok: false; message: string } | { ok: true; data: Prisma.ChargeProductUncheckedCreateInput }> {
  const kindRaw = text(formData, 'kind').toUpperCase();
  if (kindRaw !== 'DIGITAL' && kindRaw !== 'PHYSICAL') {
    return { ok: false, message: '상품 종류를 선택해 주세요.' };
  }
  const kind = kindRaw as ProductKind;

  const name = text(formData, 'name').slice(0, 40);
  if (!name) return { ok: false, message: '상품 이름을 입력해 주세요.' };

  const amount = parseAmount(text(formData, 'amount'));
  if (amount === null || amount <= 0n) return { ok: false, message: '판매 금액은 숫자만 입력해 주세요.' };

  const range = await effectiveAmountRange(merchantId);
  if (!range) return { ok: false, message: '가맹점 정보를 찾을 수 없습니다.' };
  if (range.min > range.max) {
    return { ok: false, message: '관리자 설정과 한도 정책이 충돌해 만들 수 있는 금액이 없습니다. 고객센터로 문의해 주세요.' };
  }
  if (amount < range.min || amount > range.max) {
    // 실물은 여기에 배송비까지 더해져 결제되므로, 상품값만으로도 한도를 넘으면 아예 팔 수 없다.
    return {
      ok: false,
      message:
        kind === 'PHYSICAL'
          ? `실물 상품 가격은 ${formatWon(range.min)} ~ ${formatWon(range.max)} 사이여야 합니다. (결제 시 배송비가 더해지므로 한도를 꽉 채우지 마세요)`
          : `판매 금액은 ${formatWon(range.min)} ~ ${formatWon(range.max)} 사이여야 합니다.`,
    };
  }

  const description = text(formData, 'description').slice(0, 300) || null;
  const imageUrl = text(formData, 'imageUrl').slice(0, 500) || null;
  const sortOrderRaw = Number.parseInt(text(formData, 'sortOrder') || '0', 10);
  const sortOrder = Number.isFinite(sortOrderRaw) ? Math.max(0, Math.min(999, sortOrderRaw)) : 0;

  const base = {
    id: newId(),
    merchantId,
    kind,
    name,
    amount,
    description,
    imageUrl,
    sortOrder,
    active: !formData.has('active') || checked(formData, 'active'),
  } satisfies Partial<Prisma.ChargeProductUncheckedCreateInput> as Prisma.ChargeProductUncheckedCreateInput;

  if (kind === 'DIGITAL') {
    const typeRaw = text(formData, 'digitalType').toUpperCase();
    if (typeRaw !== 'POINT' && typeRaw !== 'VOUCHER' && typeRaw !== 'PASS') {
      return { ok: false, message: '비실물 상품 유형(포인트·상품권·이용권)을 선택해 주세요.' };
    }
    const digitalType = typeRaw as DigitalProductType;

    // 포인트는 금액과 1:1 이 원칙이다. 보너스를 주려면 지급 수량을 따로 적는다.
    const giveRaw = text(formData, 'giveAmount');
    let giveAmount = giveRaw ? parseAmount(giveRaw) : null;
    if (giveRaw && (giveAmount === null || giveAmount <= 0n)) {
      return { ok: false, message: '지급 수량은 숫자만 입력해 주세요.' };
    }
    if (digitalType === 'POINT' && giveAmount === null) giveAmount = amount;

    const validRaw = text(formData, 'validDays');
    let validDays: number | null = null;
    if (validRaw) {
      const n = Number.parseInt(validRaw, 10);
      if (!Number.isInteger(n) || n < 1 || n > 3650) {
        return { ok: false, message: '유효기간은 1~3650일 사이 정수로 입력해 주세요.' };
      }
      validDays = n;
    }
    if (digitalType === 'PASS' && validDays === null) {
      return { ok: false, message: '이용권은 유효기간(일)을 입력해 주세요.' };
    }

    return {
      ok: true,
      data: {
        ...base,
        digitalType,
        giveAmount,
        giveUnit: text(formData, 'giveUnit').slice(0, 10) || null,
        validDays,
      },
    };
  }

  // ── 실물 ──────────────────────────────────────────────────────────
  const intOrNull = (key: string, max: number): number | null | 'ERR' => {
    const raw = text(formData, key);
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    if (!Number.isInteger(n) || n < 0 || n > max) return 'ERR';
    return n;
  };

  const stock = intOrNull('stock', 1_000_000);
  if (stock === 'ERR') return { ok: false, message: '재고는 0 이상 1,000,000 이하 정수로 입력해 주세요. (비우면 무제한)' };
  const stockAlert = intOrNull('stockAlert', 1_000_000);
  if (stockAlert === 'ERR') return { ok: false, message: '재고 경고 기준은 0 이상 정수로 입력해 주세요.' };
  const maxPerOrder = intOrNull('maxPerOrder', 999);
  if (maxPerOrder === 'ERR') return { ok: false, message: '1회 주문 최대 수량은 1~999 사이 정수로 입력해 주세요.' };
  if (maxPerOrder !== null && maxPerOrder < 1) {
    return { ok: false, message: '1회 주문 최대 수량은 1 이상이어야 합니다. (비우면 제한 없음)' };
  }

  const freeShipping = checked(formData, 'freeShipping');

  const feeRaw = text(formData, 'shippingFee');
  let shippingFee: bigint | null = null;
  if (feeRaw) {
    const v = parseAmount(feeRaw);
    if (v === null || v < 0n) return { ok: false, message: '배송비는 0 이상 숫자로 입력해 주세요. (비우면 기본 배송정책)' };
    shippingFee = v;
  }

  const overRaw = text(formData, 'freeShipOver');
  let freeShipOver: bigint | null = null;
  if (overRaw) {
    const v = parseAmount(overRaw);
    if (v === null || v <= 0n) return { ok: false, message: '조건부 무료 기준 금액은 0보다 큰 숫자로 입력해 주세요.' };
    freeShipOver = v;
  }

  const options = parseOptionLines(text(formData, 'options'));

  return {
    ok: true,
    data: {
      ...base,
      sku: text(formData, 'sku').slice(0, 40) || null,
      stock,
      stockAlert,
      maxPerOrder,
      freeShipping,
      shippingFee,
      freeShipOver,
      options: options.length > 0 ? (options as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
    },
  };
}

/** 상품 추가 (비실물·실물 공용). */
export async function createChargeProductAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withMerchant(async (merchantId) => {
    const parsed = await parseProductForm(merchantId, formData);
    if (!parsed.ok) return { ok: false, message: parsed.message };

    const count = await prisma.chargeProduct.count({
      where: { merchantId, kind: parsed.data.kind, archivedAt: null },
    });
    if (count >= MAX_CHARGE_PRODUCTS) {
      return { ok: false, message: `상품은 종류별로 최대 ${MAX_CHARGE_PRODUCTS}개까지 등록할 수 있습니다.` };
    }

    // 같은 이름이 둘이면 이용자가 결제 화면에서 무엇을 고르는지 알 수 없다.
    const dup = await prisma.chargeProduct.findFirst({
      where: { merchantId, name: parsed.data.name, archivedAt: null },
      select: { id: true },
    });
    if (dup) return { ok: false, message: '같은 이름의 상품이 이미 있습니다.' };

    await prisma.chargeProduct.create({
      data: { ...parsed.data, sortOrder: parsed.data.sortOrder ?? count },
    });
    revalidatePath('/studio/products');
    revalidatePath('/studio/settings');
    return { ok: true, message: `${parsed.data.name} 상품을 추가했습니다.` };
  });
}

/** 상품 수정. 종류(비실물/실물)는 바꿀 수 없다. */
export async function updateChargeProductAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withMerchant(async (merchantId) => {
    const id = text(formData, 'productId');
    if (!id) return { ok: false, message: '상품을 찾을 수 없습니다.' };

    // 남의 상품을 수정할 수 없도록 merchantId 를 조건에 함께 건다.
    const current = await prisma.chargeProduct.findFirst({
      where: { id, merchantId, archivedAt: null },
      select: { id: true, kind: true },
    });
    if (!current) return { ok: false, message: '상품을 찾을 수 없습니다.' };

    // 종류가 바뀌면 이미 팔린 주문의 배송 유무가 뒤집힌다. 폼 값 대신 저장된 종류를 쓴다.
    formData.set('kind', current.kind);
    const parsed = await parseProductForm(merchantId, formData);
    if (!parsed.ok) return { ok: false, message: parsed.message };

    const dup = await prisma.chargeProduct.findFirst({
      where: { merchantId, name: parsed.data.name, archivedAt: null, id: { not: id } },
      select: { id: true },
    });
    if (dup) return { ok: false, message: '같은 이름의 상품이 이미 있습니다.' };

    const { id: _newId, merchantId: _m, kind: _k, ...rest } = parsed.data;
    await prisma.chargeProduct.update({ where: { id }, data: rest });
    revalidatePath('/studio/products');
    revalidatePath('/studio/settings');
    return { ok: true, message: '상품을 저장했습니다.' };
  });
}

/**
 * 상품 보관(소프트 삭제).
 * 과거 주문이 상품을 참조하므로 실제로 지우지 않는다.
 */
export async function archiveChargeProductAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withMerchant(async (merchantId) => {
    const id = text(formData, 'productId');
    if (!id) return { ok: false, message: '상품을 찾을 수 없습니다.' };

    const current = await prisma.chargeProduct.findFirst({
      where: { id, merchantId, archivedAt: null },
      select: { id: true, name: true },
    });
    if (!current) return { ok: false, message: '상품을 찾을 수 없습니다.' };

    const merchant = await prisma.merchantProfile.findUniqueOrThrow({
      where: { id: merchantId },
      select: { allowCustomAmount: true },
    });
    const remain = await prisma.chargeProduct.count({
      where: { merchantId, active: true, archivedAt: null, id: { not: id } },
    });
    if (remain === 0 && !merchant.allowCustomAmount) {
      return {
        ok: false,
        message: '마지막 상품입니다. 먼저 직접 입력을 허용하거나 다른 상품을 추가해 주세요.',
      };
    }

    await prisma.chargeProduct.update({
      where: { id },
      data: { archivedAt: new Date(), active: false },
    });
    revalidatePath('/studio/products');
    revalidatePath('/studio/settings');
    return { ok: true, message: `${current.name} 상품을 보관했습니다.` };
  });
}

/** 실물 상품 재고만 빠르게 조정한다(입고·조정). */
export async function adjustProductStockAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withMerchant(async (merchantId) => {
    const id = text(formData, 'productId');
    const raw = text(formData, 'stock');
    if (!id) return { ok: false, message: '상품을 찾을 수 없습니다.' };

    const current = await prisma.chargeProduct.findFirst({
      where: { id, merchantId, kind: 'PHYSICAL', archivedAt: null },
      select: { id: true, name: true },
    });
    if (!current) return { ok: false, message: '실물 상품을 찾을 수 없습니다.' };

    // 비우면 '무제한'으로 되돌린다.
    if (!raw) {
      await prisma.chargeProduct.update({ where: { id }, data: { stock: null } });
      revalidatePath('/studio/products');
      return { ok: true, message: `${current.name} 재고를 무제한으로 바꿨습니다.` };
    }

    const n = Number.parseInt(raw, 10);
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
      return { ok: false, message: '재고는 0 이상 1,000,000 이하 정수로 입력해 주세요.' };
    }
    await prisma.chargeProduct.update({ where: { id }, data: { stock: n } });
    revalidatePath('/studio/products');
    return { ok: true, message: `${current.name} 재고를 ${n.toLocaleString('ko-KR')}개로 맞췄습니다.` };
  });
}

/** 가맹점 기본 배송정책 저장. 상품별 값이 없으면 이 값이 쓰인다. */
export async function saveShippingPolicyAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withMerchant(async (merchantId) => {
    const baseFee = parseAmount(text(formData, 'baseFee'));
    if (baseFee === null || baseFee < 0n) return { ok: false, message: '기본 배송비는 0 이상 숫자로 입력해 주세요.' };
    if (baseFee > 100_000n) return { ok: false, message: '기본 배송비가 너무 큽니다. 100,000원 이하로 입력해 주세요.' };

    const overRaw = text(formData, 'freeOver');
    let freeOver: bigint | null = null;
    if (overRaw) {
      const v = parseAmount(overRaw);
      if (v === null || v <= 0n) return { ok: false, message: '조건부 무료 기준 금액은 0보다 큰 숫자로 입력해 주세요.' };
      freeOver = v;
    }

    const remoteRaw = text(formData, 'remoteFee');
    let remoteFee = 0n;
    if (remoteRaw) {
      const v = parseAmount(remoteRaw);
      if (v === null || v < 0n) return { ok: false, message: '도서산간 추가 배송비는 0 이상 숫자로 입력해 주세요.' };
      remoteFee = v;
    }

    const data = {
      baseFee,
      freeOver,
      remoteFee,
      carrier: text(formData, 'carrier').slice(0, 30) || null,
      guide: text(formData, 'guide').slice(0, 300) || null,
    };

    await prisma.merchantShippingPolicy.upsert({
      where: { merchantId },
      create: { id: newId(), merchantId, ...data },
      update: data,
    });
    revalidatePath('/studio/products');
    return {
      ok: true,
      message: freeOver
        ? `배송정책을 저장했습니다. ${formatWon(baseFee)} · ${formatWon(freeOver)} 이상 무료배송`
        : `배송정책을 저장했습니다. 기본 배송비 ${formatWon(baseFee)}`,
    };
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
  return withMerchant(async (merchantId) => {
    const raw = text(formData, 'thanksMtMessage');

    if (raw.length === 0) {
      await prisma.merchantProfile.update({ where: { id: merchantId }, data: { thanksMtMessage: null } });
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
    const rules = await loadBannedWords(merchantId);
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

    await prisma.merchantProfile.update({ where: { id: merchantId }, data: { thanksMtMessage: raw } });
    revalidatePath('/studio/settings');
    return { ok: true, message: '감사 문자 내용을 저장했습니다. 다음 결제부터 적용됩니다.' };
  });
}

// ===========================================================================
// MO 안내 문자 (감사 문자와 별개)
// ===========================================================================

const MO_GUIDE_TOKENS = MO_GUIDE_VARIABLES.map((v) => v.token.slice(1, -1));

/**
 * MO 를 받았을 때 보내는 안내 문자 본문 저장.
 *
 * 결제가 끝난 뒤 보내는 감사 문자와는 **다른 문자**다. 이 문자에는 결제 링크가 붙는다.
 *
 * 검증 규칙 (감사 문자보다 엄격하다 — 링크가 붙는 문자라 사칭·피싱 위험이 크다)
 *  - 160자 이내. 비우면 기본 문구로 돌아간다.
 *  - 가맹점이 링크를 직접 넣을 수 없다. 결제 링크는 시스템이 본문 끝에 붙인다.
 *  - "아직 결제되지 않았습니다" 고지도 시스템이 붙이므로 지울 수 없다.
 *  - 정의되지 않은 치환자를 남기면 이용자에게 `{...}` 가 그대로 발송된다.
 */
export async function updateMoGuideMessageAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withMerchant(async (merchantId) => {
    const raw = text(formData, 'moGuideMtMessage');

    if (raw.length === 0) {
      await prisma.merchantProfile.update({ where: { id: merchantId }, data: { moGuideMtMessage: null } });
      revalidatePath('/studio/settings');
      return { ok: true, message: 'MO 안내 문자를 기본 문구로 되돌렸습니다.' };
    }

    if (raw.length > MO_GUIDE_MAX_LENGTH) {
      return { ok: false, message: `안내 문자는 ${MO_GUIDE_MAX_LENGTH}자 이내로 입력해 주세요. (현재 ${raw.length}자) 결제 링크가 뒤에 붙으므로 여유를 두세요.` };
    }
    if (/https?:\/\/|www\./i.test(raw)) {
      return { ok: false, message: '안내 문자에는 링크를 넣을 수 없습니다. 결제 링크는 문자페이가 본문 끝에 자동으로 붙입니다.' };
    }

    const unknown = [...raw.matchAll(/\{([^{}]*)\}/g)]
      .map((m) => m[1])
      .filter((name) => !MO_GUIDE_TOKENS.includes(name));
    if (unknown.length > 0) {
      return {
        ok: false,
        message: `사용할 수 없는 치환자입니다: {${unknown[0]}} — ${MO_GUIDE_VARIABLES.map((v) => v.token).join(' ')} 만 사용할 수 있습니다.`,
      };
    }

    const rules = await loadBannedWords(merchantId);
    const filtered = filterContent(raw, { bannedWords: rules, maxLength: MO_GUIDE_MAX_LENGTH });
    if (filtered.action === 'BLOCK') {
      return {
        ok: false,
        message: `운영정책에 어긋나는 표현이 있어 저장할 수 없습니다.${filtered.reasons.length ? ` (${filtered.reasons.join(', ')})` : ''}`,
      };
    }
    if (filtered.containsPersonalInfo) {
      return { ok: false, message: '전화번호·계좌번호 등 개인정보는 안내 문자에 넣을 수 없습니다.' };
    }

    await prisma.merchantProfile.update({ where: { id: merchantId }, data: { moGuideMtMessage: raw } });
    revalidatePath('/studio/settings');
    return { ok: true, message: 'MO 안내 문자를 저장했습니다. 다음 문자부터 적용됩니다.' };
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
  return withMerchant(async (merchantId) => {
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

    const exists = await prisma.bannedWord.findFirst({ where: { merchantId, word, scope: 'MERCHANT' } });
    if (exists) return { ok: false, message: '이미 등록된 금칙어입니다.' };

    await prisma.bannedWord.create({
      data: { id: newId(), word, action: parsed.data.action, scope: 'MERCHANT', merchantId, active: true },
    });

    revalidatePath('/studio/moderation');
    return { ok: true, message: `금칙어 "${word}"를 등록했습니다.` };
  });
}

export async function toggleBannedWordAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withMerchant(async (merchantId) => {
    const id = text(formData, 'id');
    const row = await prisma.bannedWord.findUnique({ where: { id }, select: { merchantId: true, scope: true, active: true } });
    if (!row || row.merchantId !== merchantId || row.scope !== 'MERCHANT') {
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
  return withMerchant(async (merchantId) => {
    const id = text(formData, 'id');
    const row = await prisma.bannedWord.findUnique({ where: { id }, select: { merchantId: true, scope: true } });
    if (!row || row.merchantId !== merchantId || row.scope !== 'MERCHANT') {
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
  return withMerchant(async (merchantId) => {
    const existing = new Set(
      (await prisma.bannedWord.findMany({ where: { merchantId, scope: 'MERCHANT' }, select: { word: true } })).map((w) => w.word),
    );
    const toAdd = DEFAULT_BANNED_WORDS.filter((w) => !existing.has(w));
    if (toAdd.length === 0) return { ok: true, message: '기본 금칙어가 이미 모두 등록되어 있습니다.' };

    await prisma.bannedWord.createMany({
      data: toAdd.map((word) => ({ id: newId(), word, action: 'MASK' as const, scope: 'MERCHANT' as const, merchantId, active: true })),
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
  return withMerchant(async (merchantId) => {
    const sample = text(formData, 'sample');
    if (!sample) return { ok: false, message: '테스트할 문장을 입력해 주세요.' };

    const rules = await loadBannedWords(merchantId);
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

/**
 * 원천징수 신고용 주민등록번호 사전 등록.
 *
 * 자동 정산으로 바뀌면서 가맹점이 "정산 요청"을 하는 단계가 사라졌다.
 * 지급 회차는 배치가 만들기 때문에, 개인 가맹점은 신고용 번호를 미리 등록해 둬야
 * 지급 시점에 원천징수 신고 정보가 회차에 남는다.
 *
 * 사업자등록번호가 등록된 가맹점은 세금계산서 대상이라 원천징수하지 않으므로 등록 대상이 아니다.
 */
export async function saveWithholdingResidentAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withMerchant(async (merchantId) => {
    const account = await prisma.settlementAccount.findUnique({
      where: { merchantId },
      select: { id: true },
    });
    if (!account) return { ok: false, message: '정산 계좌를 먼저 등록해 주세요.' };

    const profile = await prisma.merchantProfile.findUnique({
      where: { id: merchantId },
      select: { businessNo: true },
    });
    if (profile?.businessNo) {
      return { ok: false, message: '사업자 가맹점은 원천징수 대상이 아닙니다. 주민등록번호를 등록할 수 없습니다.' };
    }

    const residentRaw = text(formData, 'resident');
    // 마스킹 값이 그대로 넘어온 경우(재사용)는 변경 없음으로 본다.
    if (residentRaw.includes('*')) {
      return { ok: true, message: '등록된 원천징수 신고 정보를 그대로 사용합니다.' };
    }
    if (!residentRaw) return { ok: false, message: '주민등록번호 13자리를 입력해 주세요.' };
    if (!checked(formData, 'residentAgree')) {
      return { ok: false, message: '주민등록번호 수집·이용에 동의해 주세요.' };
    }

    const norm = normalizeResident(residentRaw);
    if (!norm) return { ok: false, message: '주민등록번호 13자리를 정확히 입력해 주세요.' };
    if (!isValidResident(norm)) return { ok: false, message: '주민등록번호가 올바르지 않습니다. 다시 확인해 주세요.' };

    await prisma.settlementAccount.update({
      where: { merchantId },
      data: { residentEnc: encrypt(norm), residentMasked: maskResident(norm) },
    });

    revalidatePath('/studio/settlement');
    return { ok: true, message: '원천징수 신고 정보를 저장했습니다. 지급 회차 생성 시 자동으로 사용됩니다.' };
  });
}

export async function saveSettlementAccountAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withMerchant(async (merchantId) => {
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
      where: { merchantId },
      create: { id: newId(), merchantId, ...data },
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

export async function updateMerchantProfileAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withMerchant(async (merchantId) => {
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

    await prisma.merchantProfile.update({
      where: { id: merchantId },
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
 * 결제 페이지 설정 (배너 · 소개).
 * 이용자에게 보이는 결제 페이지의 겉모습을 정한다.
 *
 */
export async function updateChargePageAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withMerchant(async (merchantId) => {
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

    await prisma.merchantProfile.update({
      where: { id: merchantId },
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

// ===========================================================================
// 연동 API 키 (선택 기능)
// ===========================================================================

/** 가맹점당 동시에 유효한 키 개수 상한. 키가 늘어날수록 유출 위험도 커진다. */
const API_KEY_MAX_ACTIVE = 3;

/**
 * 연동 API 키 발급.
 * 키 원문과 서명 비밀키는 이 응답에서 1회만 보여주고 저장하지 않는다.
 */
export async function createApiKeyAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withMerchant(async (merchantId) => {
    const active = await prisma.merchantApiKey.count({ where: { merchantId, revokedAt: null } });
    if (active >= API_KEY_MAX_ACTIVE) {
      return { ok: false, message: `유효한 키는 최대 ${API_KEY_MAX_ACTIVE}개까지 둘 수 있습니다. 쓰지 않는 키를 먼저 폐기해 주세요.` };
    }

    const name = text(formData, 'name').slice(0, 40) || '연동 키';
    const issued = await issueMerchantApiKey(merchantId, name);

    revalidatePath('/studio/settings');
    return {
      ok: true,
      message: `연동 키 "${issued.name}" 를 발급했습니다. 아래 값은 지금만 볼 수 있습니다.`,
      secret: `API 키\n${issued.apiKey}\n\n서명 비밀키\n${issued.signingSecret}`,
      secretLabel: '연동 키 (지금만 확인 가능)',
      secretHint: '이 화면을 벗어나면 다시 볼 수 없습니다. 안전한 곳에 보관하고, 유출되면 즉시 폐기 후 재발급하세요.',
    };
  });
}

/** 연동 API 키 폐기. 폐기 즉시 해당 키로는 인증되지 않는다. */
export async function revokeApiKeyAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withMerchant(async (merchantId) => {
    const id = text(formData, 'keyId');
    if (!id) return { ok: false, message: '폐기할 키를 선택해 주세요.' };

    // 본인 가맹점 키인지 반드시 확인한다.
    const result = await prisma.merchantApiKey.updateMany({
      where: { id, merchantId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) return { ok: false, message: '이미 폐기되었거나 존재하지 않는 키입니다.' };

    revalidatePath('/studio/settings');
    return { ok: true, message: '연동 키를 폐기했습니다.' };
  });
}

// ===========================================================================
// 주문 · 배송 (실물 상품)
// ===========================================================================

const SHIPMENT_STATUSES = ['PREPARING', 'SHIPPED', 'DELIVERED', 'CANCELED'] as const;

/**
 * 배송 정보 저장 (송장 입력 · 상태 변경).
 *
 * 발송(SHIPPED)으로 바꾸려면 택배사와 송장번호가 있어야 한다.
 * 송장 없이 발송 처리하면 이용자가 조회할 수 없고, 분쟁 시 발송 사실을 증명하지 못한다.
 */
export async function updateShipmentAction(
  _prev: StudioActionState,
  formData: FormData,
): Promise<StudioActionState> {
  return withMerchant(async (merchantId) => {
    const chargeId = text(formData, 'chargeId');
    if (!chargeId) return { ok: false, message: '주문을 찾을 수 없습니다.' };

    const statusRaw = text(formData, 'status').toUpperCase();
    if (!SHIPMENT_STATUSES.includes(statusRaw as (typeof SHIPMENT_STATUSES)[number])) {
      return { ok: false, message: '배송 상태를 선택해 주세요.' };
    }
    const status = statusRaw as (typeof SHIPMENT_STATUSES)[number];

    // 남의 가맹점 주문을 건드릴 수 없도록 merchantId 를 조건에 함께 건다.
    const current = await prisma.chargeShipment.findFirst({
      where: { chargeId, merchantId },
      select: { id: true, status: true, shippedAt: true },
    });
    if (!current) return { ok: false, message: '주문을 찾을 수 없습니다.' };

    const carrier = text(formData, 'carrier').slice(0, 30) || null;
    const trackingNo = text(formData, 'trackingNo').replace(/[^0-9A-Za-z-]/g, '').slice(0, 40) || null;

    if (status === 'SHIPPED' && (!carrier || !trackingNo)) {
      return { ok: false, message: '발송 처리에는 택배사와 송장번호가 필요합니다.' };
    }

    const now = new Date();
    await prisma.chargeShipment.update({
      where: { chargeId },
      data: {
        status,
        carrier,
        trackingNo,
        memo: text(formData, 'memo').slice(0, 100) || null,
        // 발송 시각은 처음 발송으로 바꾼 때만 기록한다(수정할 때마다 갱신하면 배송 지연을 못 본다).
        shippedAt: status === 'SHIPPED' ? current.shippedAt ?? now : status === 'PREPARING' ? null : current.shippedAt,
        deliveredAt: status === 'DELIVERED' ? now : null,
      },
    });

    revalidatePath('/studio/orders');
    return {
      ok: true,
      message:
        status === 'SHIPPED'
          ? `발송 처리했습니다. (${carrier} ${trackingNo})`
          : status === 'DELIVERED'
            ? '배송 완료로 표시했습니다.'
            : status === 'CANCELED'
              ? '배송을 취소 상태로 표시했습니다. 결제 환불은 별도로 진행해 주세요.'
              : '배송 준비 상태로 되돌렸습니다.',
    };
  });
}
