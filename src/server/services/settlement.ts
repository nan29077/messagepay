import { prisma, withAdvisoryLock } from '@/server/db';
import { newId } from '@/lib/id';
import { applyRate } from '@/lib/money';
import { kstMonthKey } from '@/lib/datetime';
import type { LedgerEntryType } from '@/generated/prisma/enums';

/**
 * 정산 원장.
 *
 * 규칙
 *  - settlement_ledger 는 APPEND ONLY. UPDATE/DELETE 하지 않는다.
 *  - 정정이 필요하면 반대 부호 분개를 추가한다.
 *  - 후원 거래 원장 / 결제 거래 원장 / 정산 원장은 분리하되 donation_id 로 추적한다.
 *  - 정산 가능 금액 = 원장 합계 - 보류(미정산 요청 중) - 이미 지급
 */

export interface FeeBreakdown {
  gross: bigint;
  pgFee: bigint;
  platformFee: bigint;
  net: bigint;
  pgFeeRate: string;
  platformFeeRate: string;
}

export async function resolveFeePolicy(creatorId: string) {
  const rows = await prisma.feePolicy.findMany({
    where: { active: true, OR: [{ scope: 'GLOBAL' }, { scope: 'CREATOR', creatorId }] },
    orderBy: { effectiveFrom: 'desc' },
  });
  return rows.find((r) => r.scope === 'CREATOR') ?? rows.find((r) => r.scope === 'GLOBAL') ?? null;
}

export async function calculateFees(creatorId: string, amount: bigint): Promise<FeeBreakdown> {
  const policy = await resolveFeePolicy(creatorId);
  const pgRate = policy ? policy.pgFeeRate.toString() : '0.018';
  const platformRate = policy ? policy.platformFeeRate.toString() : '0.15';
  const pgFixed = policy?.pgFixedFee ?? 0n;

  const pgFee = applyRate(amount, pgRate, pgFixed);
  const platformFee = applyRate(amount, platformRate);
  const net = amount - pgFee - platformFee;

  return {
    gross: amount,
    pgFee,
    platformFee,
    net: net < 0n ? 0n : net,
    pgFeeRate: pgRate,
    platformFeeRate: platformRate,
  };
}

export interface LedgerInput {
  creatorId: string;
  entryType: LedgerEntryType;
  amount: bigint;
  donationId?: string | null;
  refundId?: string | null;
  requestId?: string | null;
  memo?: string;
  occurredAt?: Date;
}

/** appendLedger 가 받는 클라이언트 (전역 prisma 또는 트랜잭션 tx) */
type LedgerClient = Pick<typeof prisma, 'settlementLedger'> | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export async function appendLedger(entries: LedgerInput[], client: LedgerClient = prisma) {
  if (entries.length === 0) return;
  await client.settlementLedger.createMany({
    data: entries.map((e) => {
      const at = e.occurredAt ?? new Date();
      return {
        id: newId(),
        creatorId: e.creatorId,
        entryType: e.entryType,
        amount: e.amount,
        donationId: e.donationId ?? null,
        refundId: e.refundId ?? null,
        requestId: e.requestId ?? null,
        memo: e.memo ?? null,
        occurredAt: at,
        settlementKey: kstMonthKey(at),
      };
    }),
  });
}

/** 후원 결제 성공 시 3분개 (총액 / PG수수료 / 플랫폼수수료) */
export async function postDonationSettlement(input: {
  creatorId: string;
  donationId: string;
  amount: bigint;
  fees: FeeBreakdown;
  occurredAt?: Date;
}) {
  await appendLedger([
    {
      creatorId: input.creatorId, entryType: 'DONATION_GROSS', amount: input.fees.gross,
      donationId: input.donationId, occurredAt: input.occurredAt, memo: '문자후원 결제 승인',
    },
    {
      creatorId: input.creatorId, entryType: 'PG_FEE', amount: -input.fees.pgFee,
      donationId: input.donationId, occurredAt: input.occurredAt, memo: `결제수수료 ${input.fees.pgFeeRate}`,
    },
    {
      creatorId: input.creatorId, entryType: 'PLATFORM_FEE', amount: -input.fees.platformFee,
      donationId: input.donationId, occurredAt: input.occurredAt, memo: `플랫폼수수료 ${input.fees.platformFeeRate}`,
    },
  ]);
}

/** 환불 시 반대 분개 (수수료 환입 정책 포함) */
export async function postRefundSettlement(input: {
  creatorId: string;
  donationId: string;
  refundId: string;
  amount: bigint;
  fees: FeeBreakdown;
  returnPlatformFee?: boolean;
  occurredAt?: Date;
}) {
  const entries: LedgerInput[] = [
    {
      creatorId: input.creatorId, entryType: 'REFUND', amount: -input.amount,
      donationId: input.donationId, refundId: input.refundId, occurredAt: input.occurredAt, memo: '후원 환불',
    },
  ];
  if (input.returnPlatformFee !== false) {
    entries.push({
      creatorId: input.creatorId, entryType: 'REFUND_FEE_RETURN', amount: input.fees.platformFee,
      donationId: input.donationId, refundId: input.refundId, occurredAt: input.occurredAt,
      memo: '환불에 따른 플랫폼수수료 환입',
    });
  }
  await appendLedger(entries);
}

export interface SettlementSummary {
  totalGross: bigint;
  totalPgFee: bigint;
  totalPlatformFee: bigint;
  totalRefund: bigint;
  totalAdjustment: bigint;
  totalPaid: bigint;
  /** 원장 순합계 */
  balance: bigint;
  /** 정산 요청 중이라 보류된 금액 */
  pending: bigint;
  /** 지금 정산 요청 가능한 금액 */
  available: bigint;
}

export async function getSettlementSummary(creatorId: string): Promise<SettlementSummary> {
  const grouped = await prisma.settlementLedger.groupBy({
    by: ['entryType'],
    where: { creatorId },
    _sum: { amount: true },
  });

  const sum = (t: LedgerEntryType) => grouped.find((g) => g.entryType === t)?._sum.amount ?? 0n;

  const totalGross = sum('DONATION_GROSS');
  const totalPgFee = -sum('PG_FEE');
  const totalPlatformFee = -sum('PLATFORM_FEE');
  const totalRefund = -(sum('REFUND') + sum('REFUND_FEE_RETURN'));
  const totalAdjustment = sum('ADJUSTMENT');
  const totalPaid = -(sum('PAYOUT') + sum('PAYOUT_WITHHOLDING'));

  const balance = grouped.reduce((acc, g) => acc + (g._sum.amount ?? 0n), 0n);

  const pendingAgg = await prisma.settlementRequest.aggregate({
    where: { creatorId, status: { in: ['REQUESTED', 'REVIEWING', 'APPROVED'] } },
    _sum: { amount: true },
  });
  const pending = pendingAgg._sum.amount ?? 0n;
  const available = balance - pending;

  return {
    totalGross, totalPgFee, totalPlatformFee, totalRefund, totalAdjustment, totalPaid,
    balance,
    pending,
    available: available < 0n ? 0n : available,
  };
}

/**
 * 정산 요청 생성. 가능 금액 초과 요청을 막는다.
 * 크리에이터 단위 advisory lock 으로 동시 요청을 직렬화한다.
 * (잠금 없이는 두 요청이 같은 가용 금액을 읽고 둘 다 통과해 잔액 초과 이중 요청이 생긴다)
 */
export async function createSettlementRequest(creatorId: string, amount: bigint, memo?: string) {
  if (amount <= 0n) throw new Error('정산 요청 금액이 올바르지 않습니다.');

  return prisma.$transaction(async (tx) =>
    withAdvisoryLock(tx, `settlement:req:${creatorId}`, async () => {
      // 잠금 획득 후 읽어야 앞선 요청의 커밋 결과가 반영된 값을 본다
      const summary = await getSettlementSummary(creatorId);
      if (amount > summary.available) throw new Error('정산 가능 금액을 초과했습니다.');

      const account = await tx.settlementAccount.findUnique({ where: { creatorId } });
      if (!account || !account.verified) throw new Error('정산 계좌 인증이 완료되지 않았습니다.');

      // 원천징수 3.3% (사업소득 기준). 실제 적용은 세무 자문 후 확정한다.
      const withholding = applyRate(amount, 0.033);

      return tx.settlementRequest.create({
        data: {
          id: newId(),
          creatorId,
          amount,
          withholding,
          payoutAmount: amount - withholding,
          memo: memo ?? null,
        },
      });
    }),
  );
}

/**
 * 지급 완료 처리 시 원장에 PAYOUT 분개를 추가한다.
 * 요청 단위 advisory lock + 단일 트랜잭션으로, 관리자 이중 클릭 시
 * append-only 원장에 지급 분개가 중복 기록되는 것을 막는다.
 */
export async function markSettlementPaid(requestId: string, adminId?: string) {
  return prisma.$transaction(async (tx) =>
    withAdvisoryLock(tx, `settlement:paid:${requestId}`, async () => {
      const req = await tx.settlementRequest.findUnique({ where: { id: requestId } });
      if (!req) throw new Error('정산 요청을 찾을 수 없습니다.');
      if (req.status === 'PAID') return req;

      const now = new Date();
      await appendLedger(
        [
          {
            creatorId: req.creatorId, entryType: 'PAYOUT', amount: -req.payoutAmount,
            requestId: req.id, occurredAt: now, memo: '정산 지급',
          },
          {
            creatorId: req.creatorId, entryType: 'PAYOUT_WITHHOLDING', amount: -req.withholding,
            requestId: req.id, occurredAt: now, memo: '원천징수',
          },
        ],
        tx,
      );

      return tx.settlementRequest.update({
        where: { id: requestId },
        data: { status: 'PAID', paidAt: now, adminId: adminId ?? null },
      });
    }),
  );
}
