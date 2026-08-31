import { prisma } from '@/server/db';
import { resolveSecureLink, consumeSecureLink } from './secure-link';
import { checkLimits, resolvePolicy } from './limits';
import { startPinAuthorization, setStatus } from './donation-flow';
import { newId } from '@/lib/id';

/**
 * 충전 금액 선택.
 *
 * MO 문자에는 금액이 없다. 문자를 받으면 금액 0 · PENDING_AMOUNT 로 결제 건을 만들고
 * SELECT_AMOUNT 링크를 보낸다. 이용자가 이 화면에서 충전 상품을 고르면 그때 금액이 정해지고,
 * 한도를 확인한 뒤 곧바로 결제사 PIN 인증으로 이어진다(문자를 한 번 더 보내지 않는다).
 *
 * 이중 결제 방어
 *  - 링크는 1회용이다. 금액을 확정하는 순간 consumeSecureLink 로 선점한다.
 *  - 선점에 실패하면(중복 클릭·뒤로가기 후 재제출) 아무 것도 하지 않고 거절한다.
 *  - 금액 확정은 PENDING_AMOUNT 상태에서만 가능하다(updateMany 의 조건으로 못박는다).
 */

export interface ChargeProductOption {
  id: string;
  name: string;
  amount: bigint;
}

export interface SelectAmountContext {
  linkId: string;
  donationId: string;
  creatorName: string;
  /** 이용자가 보낸 문자 내용(필터링 완료본). 참고용으로만 보여준다. */
  message: string;
  products: ChargeProductOption[];
  allowCustomAmount: boolean;
  minAmount: bigint;
  maxAmount: bigint;
  expiresAt: Date;
}

export async function loadSelectAmountContext(
  token: string,
): Promise<{ ok: true; ctx: SelectAmountContext } | { ok: false; reason: string }> {
  const res = await resolveSecureLink(token);
  if (!res.ok) {
    const reason =
      res.reason === 'EXPIRED'
        ? '유효 시간이 지난 링크입니다. 결제는 진행되지 않았습니다. 문자를 다시 보내 주세요.'
        : res.reason === 'USED'
          ? '이미 사용한 링크입니다.'
          : '유효하지 않은 링크입니다.';
    return { ok: false, reason };
  }

  const link = res.link!;
  if (link.purpose !== 'SELECT_AMOUNT' || !link.donationId) {
    return { ok: false, reason: '용도가 다른 링크입니다.' };
  }

  const donation = await prisma.donation.findUnique({
    where: { id: link.donationId },
    include: { creator: true },
  });
  if (!donation) return { ok: false, reason: '결제 거래를 찾을 수 없습니다.' };
  if (donation.status !== 'PENDING_AMOUNT') {
    return { ok: false, reason: '이미 처리된 결제입니다.' };
  }

  const [products, policy] = await Promise.all([
    prisma.chargeProduct.findMany({
      where: { creatorId: donation.creatorId, active: true, archivedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { amount: 'asc' }],
      select: { id: true, name: true, amount: true },
    }),
    resolvePolicy(donation.creatorId, donation.donorId),
  ]);

  // 유효 범위 = 가맹점 허용 범위 ∩ 한도 정책 범위.
  const minAmount =
    donation.creator.minAmount > policy.minAmount ? donation.creator.minAmount : policy.minAmount;
  const maxAmount =
    donation.creator.maxAmount < policy.maxAmount ? donation.creator.maxAmount : policy.maxAmount;

  return {
    ok: true,
    ctx: {
      linkId: link.id,
      donationId: donation.id,
      creatorName: donation.creator.displayName,
      message: donation.message,
      products: products.filter((p) => p.amount >= minAmount && p.amount <= maxAmount),
      allowCustomAmount: donation.creator.allowCustomAmount,
      minAmount,
      maxAmount,
      expiresAt: link.expiresAt,
    },
  };
}

export interface ConfirmAmountResult {
  ok: boolean;
  message: string;
  /** 결제사 PIN 입력 화면 주소 (성공했을 때만) */
  pinUrl?: string;
  expiresAt?: Date;
  /** 결제사 실연동이 아닌 mock 인지 */
  mock?: boolean;
}

export async function confirmChargeAmount(input: {
  token: string;
  /** 상품을 고른 경우 */
  productId?: string | null;
  /** 직접 입력한 경우 (원) */
  customAmount?: bigint | null;
  ip?: string;
  userAgent?: string;
}): Promise<ConfirmAmountResult> {
  const loaded = await loadSelectAmountContext(input.token);
  if (!loaded.ok) return { ok: false, message: loaded.reason };
  const ctx = loaded.ctx;

  // 금액 결정
  let amount: bigint | null = null;
  if (input.productId) {
    const product = ctx.products.find((p) => p.id === input.productId);
    if (!product) return { ok: false, message: '선택한 충전 상품을 찾을 수 없습니다.' };
    amount = product.amount;
  } else if (input.customAmount != null) {
    if (!ctx.allowCustomAmount) {
      return { ok: false, message: '이 가맹점은 직접 입력을 받지 않습니다.' };
    }
    amount = input.customAmount;
  }
  if (amount === null) return { ok: false, message: '충전 금액을 선택해 주세요.' };
  if (amount < ctx.minAmount || amount > ctx.maxAmount) {
    return {
      ok: false,
      message: `충전 금액은 ${ctx.minAmount.toString()}원 ~ ${ctx.maxAmount.toString()}원 사이여야 합니다.`,
    };
  }

  const donation = await prisma.donation.findUniqueOrThrow({
    where: { id: ctx.donationId },
    select: { id: true, creatorId: true, donorId: true },
  });
  if (!donation.donorId) return { ok: false, message: '이용자 정보를 찾을 수 없습니다.' };

  const donor = await prisma.donorProfile.findUnique({ where: { id: donation.donorId } });
  if (!donor) return { ok: false, message: '이용자 정보를 찾을 수 없습니다.' };

  const blocked = await prisma.blockedDonor.findUnique({
    where: { creatorId_donorId: { creatorId: donation.creatorId, donorId: donor.id } },
  });
  const limit = await checkLimits({
    donor,
    creatorId: donation.creatorId,
    amount,
    blockedByCreator: Boolean(blocked),
  });
  if (!limit.ok) {
    // 금액 범위 오류는 입력 실수라 이상거래로 기록하지 않는다.
    if (limit.code !== 'AMOUNT_RANGE') {
      await prisma.riskDetection.create({
        data: {
          id: newId(),
          donorId: donor.id,
          creatorId: donation.creatorId,
          donationId: donation.id,
          type: limit.code === 'VELOCITY' || limit.code === 'COOLDOWN' ? 'VELOCITY' : 'DAILY_LIMIT',
          level: 'MEDIUM',
          detail: { code: limit.code, message: limit.message, channel: 'SELECT' } as object,
        },
      });
      await setStatus(donation.id, 'LIMIT_BLOCKED', `${limit.code}: ${limit.message}`);
      // 한도로 막힌 건은 링크를 태워 같은 링크로 다시 시도하지 못하게 한다.
      await consumeSecureLink(ctx.linkId, input.ip, input.userAgent);
    }
    return { ok: false, message: limit.message ?? '이용 한도를 초과했습니다.' };
  }

  // 링크 1회 사용 선점 — 여기부터는 되돌릴 수 없다.
  const consumed = await consumeSecureLink(ctx.linkId, input.ip, input.userAgent);
  if (!consumed) return { ok: false, message: '이미 처리된 요청입니다.' };

  // 금액 확정. PENDING_AMOUNT 일 때만 바뀌므로 동시 요청이 두 번 확정하지 못한다.
  const claimed = await prisma.donation.updateMany({
    where: { id: donation.id, status: 'PENDING_AMOUNT' },
    data: { amount, status: 'RECEIVED', statusReason: null },
  });
  if (claimed.count === 0) return { ok: false, message: '이미 처리된 결제입니다.' };

  await prisma.donationStatusLog.create({
    data: {
      id: newId(),
      donationId: donation.id,
      fromStatus: 'PENDING_AMOUNT',
      toStatus: 'RECEIVED',
      reason: `충전 금액 확정 ${amount.toString()}원`,
      actor: 'donor',
    },
  });

  // 문자를 한 번 더 보내지 않고, 이 화면에서 결제사 PIN 입력으로 그대로 넘어간다.
  const pin = await startPinAuthorization(donation.id, { notify: false });
  if (!pin.ok || !pin.pinUrl) {
    return { ok: false, message: pin.message };
  }

  return {
    ok: true,
    message: pin.message,
    pinUrl: pin.pinUrl,
    expiresAt: pin.expiresAt,
    mock: pin.mock,
  };
}
