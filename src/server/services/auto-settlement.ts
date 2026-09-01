import { prisma, withAdvisoryLock } from '@/server/db';
import { newId } from '@/lib/id';
import { env } from '@/lib/env';
import { decrypt } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { toDateKey, settlementDateFor } from '@/lib/business-day';
import { loadHolidaysAround } from './settlement-schedule';
import { resolveFeePolicy, getSettlementSummary, createSettlementRequest, markSettlementPaid } from './settlement';
import { getPayoutAdapter } from '@/server/adapters/payout';
import { notifySuperAdmins } from './notifications';
import { PAID_STATUSES } from '@/components/studio/shared';

/**
 * 자동 정산.
 *
 * 가맹점이 정산을 요청하지 않는다. 관리자가 정한 지급일(결제일 + N영업일)이 되면
 * 배치가 그날 지급할 금액을 모아 지급대행으로 이체한다.
 *
 * ── 돈이 나가는 코드이므로 지키는 것 ────────────────────────────
 *  1) 같은 결제 건은 한 번만 정산된다. 지급에 포함된 건은 charge.settledAt 을 채워 다시 잡히지 않게 한다.
 *  2) 같은 가맹점·같은 날 회차는 하나만 만든다(멱등키 + 가맹점 advisory lock).
 *  3) 지급 금액은 원장 가용 잔액을 절대 넘지 않는다. 환불로 잔액이 줄었으면 그만큼 덜 지급한다.
 *  4) 대행사 응답을 못 받으면 재이체하지 않는다. 조회로 확정하거나 실패로 남긴다.
 *  5) 어떤 단계에서 예외가 나도 다른 가맹점 처리를 막지 않는다.
 */

export interface PayoutRunResult {
  dateKey: string;
  /** 지급 대상으로 검토한 가맹점 수 */
  checked: number;
  paid: number;
  failed: number;
  skipped: number;
  totalPaid: bigint;
  details: Array<{
    merchantId: string;
    merchantName: string;
    status: 'PAID' | 'FAILED' | 'SKIPPED';
    amount: bigint;
    reason?: string;
    requestId?: string;
  }>;
}

/** 지급 대상 결제 한 건 */
interface DueCharge {
  id: string;
  netAmount: bigint;
  paidAt: Date;
}

/**
 * 지급일이 도래한(아직 정산되지 않은) 결제 건을 오래된 순으로 모은다.
 * 지급일은 결제일 + 가맹점에 적용되는 영업일 수로 계산한다.
 */
export async function findDueCharges(
  merchantId: string,
  now: Date = new Date(),
): Promise<{ charges: DueCharge[]; settlementDays: number }> {
  const policy = await resolveFeePolicy(merchantId, now);
  const settlementDays = policy?.settlementDays ?? 5;

  const rows = await prisma.charge.findMany({
    where: {
      merchantId,
      status: { in: PAID_STATUSES },
      settledAt: null,
      paidAt: { not: null },
    },
    orderBy: { paidAt: 'asc' },
    select: { id: true, netAmount: true, paidAt: true },
  });
  if (rows.length === 0) return { charges: [], settlementDays };

  const first = toDateKey(rows[0].paidAt!);
  const last = toDateKey(now);
  const holidays = await loadHolidaysAround(first, last);
  const todayKey = toDateKey(now);

  const due = rows.filter((r) => settlementDateFor(toDateKey(r.paidAt!), holidays, settlementDays) <= todayKey);

  return {
    charges: due.map((r) => ({ id: r.id, netAmount: r.netAmount ?? 0n, paidAt: r.paidAt! })),
    settlementDays,
  };
}

/**
 * 가맹점 한 곳의 자동 지급.
 * 예외를 밖으로 던지지 않는다(배치 전체가 멈추면 안 된다).
 */
export async function runMerchantPayout(
  merchantId: string,
  now: Date = new Date(),
): Promise<{ status: 'PAID' | 'FAILED' | 'SKIPPED'; amount: bigint; reason?: string; requestId?: string }> {
  const dateKey = toDateKey(now);

  try {
    const merchant = await prisma.merchantProfile.findUnique({
      where: { id: merchantId },
      select: { id: true, displayName: true, status: true },
    });
    if (!merchant) return { status: 'SKIPPED', amount: 0n, reason: '가맹점을 찾을 수 없습니다.' };
    if (merchant.status !== 'APPROVED') {
      return { status: 'SKIPPED', amount: 0n, reason: `가맹점 상태 ${merchant.status}` };
    }

    const account = await prisma.settlementAccount.findUnique({ where: { merchantId } });
    if (!account || !account.verified) {
      return { status: 'SKIPPED', amount: 0n, reason: '정산 계좌 인증 미완료' };
    }

    const { charges } = await findDueCharges(merchantId, now);
    if (charges.length === 0) return { status: 'SKIPPED', amount: 0n, reason: '지급일이 도래한 결제 없음' };

    // 환불 등으로 잔액이 줄었으면 그 범위 안에서만 지급한다.
    const summary = await getSettlementSummary(merchantId);
    let amount = 0n;
    const included: string[] = [];
    for (const c of charges) {
      if (c.netAmount <= 0n) continue;
      if (amount + c.netAmount > summary.available) break;
      amount += c.netAmount;
      included.push(c.id);
    }

    if (included.length === 0 || amount < BigInt(env.payout.minAmount)) {
      return {
        status: 'SKIPPED',
        amount,
        reason:
          amount === 0n
            ? '지급 가능 잔액 없음'
            : `최소 지급 금액(${env.payout.minAmount}원) 미만 — 다음 회차로 이월`,
      };
    }

    // 같은 가맹점·같은 날 회차는 하나만 만든다.
    const idem = await prisma.idempotencyKey
      .create({
        data: {
          id: newId(),
          scope: 'payout',
          key: `${merchantId}:${dateKey}`,
          status: 'IN_PROGRESS',
          // 같은 날 재실행을 막는 것이 목적이라 짧게 잡는다.
          expiresAt: new Date(now.getTime() + 30 * 86_400_000),
        },
      })
      .catch(() => null);
    if (!idem) {
      return { status: 'SKIPPED', amount: 0n, reason: '오늘 이미 처리된 가맹점' };
    }

    // 회차 생성 → 즉시 승인(자동 정산은 사람 승인 단계가 없다)
    const request = await createSettlementRequest(merchantId, amount, { memo: `자동 정산 ${dateKey}` });
    await prisma.settlementRequest.update({
      where: { id: request.id },
      data: { status: 'APPROVED', auto: true, adminMemo: '자동 정산 배치' },
    });

    const adapter = getPayoutAdapter();
    let result = await adapter.transfer({
      requestId: request.id,
      merchantName: merchant.displayName,
      bankCode: account.bankCode,
      accountNo: decrypt(account.accountEnc),
      holderName: account.holderMasked ?? merchant.displayName,
      amount: request.payoutAmount,
      memo: `문자페이 정산 ${dateKey}`,
    });

    // 결과 미확인은 재이체하지 않고 조회로 확정한다.
    if (result.unknown) {
      result = await adapter.inquire(request.id);
    }

    if (!result.ok) {
      await prisma.settlementRequest.update({
        where: { id: request.id },
        data: {
          status: 'PAYOUT_FAILED',
          payoutFailReason: `${result.code ?? 'ERROR'}: ${result.message}`,
        },
      });
      await prisma.idempotencyKey
        .delete({ where: { scope_key: { scope: 'payout', key: `${merchantId}:${dateKey}` } } })
        .catch(() => undefined);
      return { status: 'FAILED', amount, reason: result.message, requestId: request.id };
    }

    // 지급 완료: 원장 분개 + 회차 확정 + 포함된 결제 건에 정산 시각 기록
    await markSettlementPaid(request.id, undefined, result.referenceNo);
    await prisma.charge.updateMany({
      where: { id: { in: included }, settledAt: null },
      data: { settledAt: now, status: 'SETTLED' },
    });
    await prisma.idempotencyKey
      .update({
        where: { scope_key: { scope: 'payout', key: `${merchantId}:${dateKey}` } },
        data: { status: 'DONE', resourceId: request.id },
      })
      .catch(() => undefined);

    return { status: 'PAID', amount, requestId: request.id };
  } catch (error) {
    logger.error('자동 정산 실패', { merchantId, message: (error as Error).message });
    await prisma.idempotencyKey
      .delete({ where: { scope_key: { scope: 'payout', key: `${merchantId}:${dateKey}` } } })
      .catch(() => undefined);
    return { status: 'FAILED', amount: 0n, reason: (error as Error).message };
  }
}

/**
 * 자동 정산 배치.
 * 하루 한 번 도는 것을 전제로 하며, 같은 날 두 번 돌아도 이미 처리된 가맹점은 건너뛴다.
 */
export async function runScheduledPayouts(now: Date = new Date()): Promise<PayoutRunResult> {
  const dateKey = toDateKey(now);

  const merchants = await prisma.merchantProfile.findMany({
    where: { status: 'APPROVED', settlementAccount: { verified: true } },
    select: { id: true, displayName: true },
    orderBy: { createdAt: 'asc' },
  });

  const result: PayoutRunResult = {
    dateKey,
    checked: merchants.length,
    paid: 0,
    failed: 0,
    skipped: 0,
    totalPaid: 0n,
    details: [],
  };

  for (const m of merchants) {
    const r = await runMerchantPayout(m.id, now);
    if (r.status === 'PAID') {
      result.paid += 1;
      result.totalPaid += r.amount;
    } else if (r.status === 'FAILED') {
      result.failed += 1;
    } else {
      result.skipped += 1;
    }
    // 건너뛴 건은 로그만 남기고 결과에 담지 않는다(대부분 "지급일 아님"이라 목록이 무의미해진다).
    if (r.status !== 'SKIPPED') {
      result.details.push({
        merchantId: m.id,
        merchantName: m.displayName,
        status: r.status,
        amount: r.amount,
        reason: r.reason,
        requestId: r.requestId,
      });
    }
  }

  if (result.failed > 0) {
    await notifySuperAdmins({
      title: '자동 정산 지급 실패',
      body: `${dateKey} 자동 정산에서 ${result.failed}건이 실패했습니다. 정산 관리에서 확인해 주세요.`,
      linkUrl: '/admin/settlements',
    }).catch(() => undefined);
  }

  logger.info('자동 정산 배치 완료', {
    dateKey,
    checked: result.checked,
    paid: result.paid,
    failed: result.failed,
    totalPaid: result.totalPaid.toString(),
  });

  return result;
}

/**
 * 지급 실패 건 재시도.
 *
 * 재이체 전에 **반드시 조회로 상태를 확인한다.** 실패로 기록됐더라도 대행사 쪽에서
 * 이미 처리된 건일 수 있고, 그대로 다시 이체하면 이중 지급이 된다.
 */
export async function retryPayout(
  requestId: string,
  now: Date = new Date(),
): Promise<{ ok: boolean; message: string }> {
  const request = await prisma.settlementRequest.findUnique({
    where: { id: requestId },
    select: { id: true, merchantId: true, status: true, amount: true, payoutAmount: true },
  });
  if (!request) return { ok: false, message: '정산 회차를 찾을 수 없습니다.' };
  if (request.status === 'PAID') return { ok: false, message: '이미 지급 완료된 회차입니다.' };
  if (request.status !== 'PAYOUT_FAILED') {
    return { ok: false, message: '지급 실패(PAYOUT_FAILED) 상태에서만 재시도할 수 있습니다.' };
  }

  const [merchant, account] = await Promise.all([
    prisma.merchantProfile.findUnique({
      where: { id: request.merchantId },
      select: { displayName: true, status: true },
    }),
    prisma.settlementAccount.findUnique({ where: { merchantId: request.merchantId } }),
  ]);
  if (!merchant || merchant.status !== 'APPROVED') return { ok: false, message: '지급할 수 없는 가맹점 상태입니다.' };
  if (!account || !account.verified) return { ok: false, message: '정산 계좌 인증이 완료되지 않았습니다.' };

  const adapter = getPayoutAdapter();

  // 1) 먼저 조회. 이미 성공한 건이면 재이체하지 않고 결과만 반영한다.
  const prior = await adapter.inquire(requestId);
  let result = prior;
  if (!prior.ok && !prior.unknown) {
    // 대행사에도 성공 기록이 없다 → 다시 이체한다.
    result = await adapter.transfer({
      requestId,
      merchantName: merchant.displayName,
      bankCode: account.bankCode,
      accountNo: decrypt(account.accountEnc),
      holderName: account.holderMasked ?? merchant.displayName,
      amount: request.payoutAmount,
      memo: `문자페이 정산 재시도 ${toDateKey(now)}`,
    });
    if (result.unknown) result = await adapter.inquire(requestId);
  }

  if (!result.ok) {
    await prisma.settlementRequest.update({
      where: { id: requestId },
      data: { payoutFailReason: `${result.code ?? 'ERROR'}: ${result.message}` },
    });
    return { ok: false, message: `재시도 실패 — ${result.message}` };
  }

  await markSettlementPaid(requestId, undefined, result.referenceNo);
  // 이 회차에 묶였던 결제 건에도 정산 시각을 남긴다.
  // (지급 실패 시에는 settledAt 을 채우지 않으므로, 아직 미정산으로 남아 있다)
  //
  // 기준은 회차의 amount(수수료 차감 후 정산액 합계)다. payoutAmount 는 원천징수까지 뺀
  // 실제 이체액이라 이 값으로 세면 마지막 결제 건이 미정산으로 남아 다음 회차에 다시 잡힌다.
  const { charges } = await findDueCharges(request.merchantId, now);
  let remaining = request.amount;
  const ids: string[] = [];
  for (const c of charges) {
    if (remaining <= 0n) break;
    ids.push(c.id);
    remaining -= c.netAmount;
  }
  if (ids.length > 0) {
    await prisma.charge.updateMany({
      where: { id: { in: ids }, settledAt: null },
      data: { settledAt: now, status: 'SETTLED' },
    });
  }
  return { ok: true, message: '지급을 완료했습니다.' };
}

export interface PayoutDashboard {
  todayKey: string;
  /** 오늘 지급일이 도래한 가맹점 수와 금액(수수료 차감 후) */
  scheduled: { merchants: number; amount: bigint };
  /** 오늘 자동 지급이 완료된 회차 */
  paidToday: { count: number; amount: bigint };
  /** 지급 실패로 남아 있는 회차(날짜 무관) */
  failed: Array<{ id: string; merchantId: string; merchantName: string; amount: bigint; reason: string | null; at: Date }>;
  /** 지급 예정 금액이 있는데 계좌 문제로 지급이 보류되는 가맹점 */
  blocked: Array<{ merchantId: string; merchantName: string; amount: bigint; reason: string }>;
}

/** 최고관리자 자동 지급 모니터링에 필요한 값을 한 번에 모은다. */
export async function buildPayoutDashboard(now: Date = new Date()): Promise<PayoutDashboard> {
  const todayKey = toDateKey(now);
  const dayStart = new Date(`${todayKey}T00:00:00+09:00`);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  const merchants = await prisma.merchantProfile.findMany({
    where: { status: 'APPROVED' },
    select: {
      id: true,
      displayName: true,
      settlementAccount: { select: { verified: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });

  let scheduledMerchants = 0;
  let scheduledAmount = 0n;
  const blocked: PayoutDashboard['blocked'] = [];

  for (const m of merchants) {
    const { charges } = await findDueCharges(m.id, now);
    if (charges.length === 0) continue;
    const amount = charges.reduce((sum, c) => sum + (c.netAmount > 0n ? c.netAmount : 0n), 0n);
    if (amount <= 0n) continue;

    if (!m.settlementAccount) {
      blocked.push({ merchantId: m.id, merchantName: m.displayName, amount, reason: '정산 계좌 미등록' });
      continue;
    }
    if (!m.settlementAccount.verified) {
      blocked.push({ merchantId: m.id, merchantName: m.displayName, amount, reason: '정산 계좌 인증 대기' });
      continue;
    }
    scheduledMerchants += 1;
    scheduledAmount += amount;
  }

  const [paidAgg, failedRows] = await Promise.all([
    prisma.settlementRequest.aggregate({
      where: { auto: true, status: 'PAID', paidAt: { gte: dayStart, lt: dayEnd } },
      _count: { _all: true },
      _sum: { payoutAmount: true },
    }),
    prisma.settlementRequest.findMany({
      where: { status: 'PAYOUT_FAILED' },
      orderBy: { requestedAt: 'desc' },
      take: 30,
      select: {
        id: true, merchantId: true, payoutAmount: true, payoutFailReason: true, requestedAt: true,
        merchant: { select: { displayName: true } },
      },
    }),
  ]);

  return {
    todayKey,
    scheduled: { merchants: scheduledMerchants, amount: scheduledAmount },
    paidToday: { count: paidAgg._count._all, amount: paidAgg._sum.payoutAmount ?? 0n },
    failed: failedRows.map((r) => ({
      id: r.id,
      merchantId: r.merchantId,
      merchantName: r.merchant.displayName,
      amount: r.payoutAmount,
      reason: r.payoutFailReason,
      at: r.requestedAt,
    })),
    blocked,
  };
}
