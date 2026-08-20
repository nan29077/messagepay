import { prisma, withAdvisoryLock } from '@/server/db';
import { newId } from '@/lib/id';
import { encrypt, decrypt, maskResident, normalizeResident } from '@/lib/crypto';
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

/** 원천징수율 3.3% (사업소득 기준). 화면·서버가 반드시 같은 값을 쓰도록 여기서만 정의한다. */
export const WITHHOLDING_RATE = 0.033;

export interface FeeBreakdown {
  gross: bigint;
  pgFee: bigint;
  platformFee: bigint;
  net: bigint;
  pgFeeRate: string;
  platformFeeRate: string;
}

export async function resolveFeePolicy(creatorId: string, now: Date = new Date()) {
  const rows = await prisma.feePolicy.findMany({
    // 시행일 전/종료 후 정책은 적용하지 않는다. (예약 수수료가 즉시 반영돼 정산액이 틀어지는 것을 막는다)
    where: {
      active: true,
      effectiveFrom: { lte: now },
      OR: [{ scope: 'GLOBAL' }, { scope: 'CREATOR', creatorId }],
      AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }],
    },
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

/**
 * 환불 시 환입할 수수료를 "원 거래에 실제로 기록된 분개"에서 계산한다.
 *
 * 환불 시점의 수수료율로 다시 계산하면(calculateFees(refundAmount)) 두 가지 오차가 난다.
 *  1) 원 결제 이후 수수료 정책이 바뀌면 환입액이 원 차감액과 달라져 원장이 영구히 틀어진다.
 *  2) 부분 환불에서 정액 수수료(pgFixedFee)가 통째로 다시 계산돼 과다 환입된다.
 * 따라서 원 거래의 PLATFORM_FEE 분개를 환불 비율만큼만 되돌리고,
 * 이미 환입한 금액을 빼서 여러 번 부분 환불해도 총 환입액이 원 차감액을 넘지 않게 한다.
 */
export async function resolveRefundFeeReturn(
  donationId: string,
  refundAmount: bigint,
): Promise<{ platformFeeReturn: bigint; grossPosted: bigint; platformFeePosted: bigint }> {
  const rows = await prisma.settlementLedger.findMany({
    where: { donationId },
    select: { entryType: true, amount: true },
  });

  const sumOf = (t: LedgerEntryType) =>
    rows.filter((r) => r.entryType === t).reduce((acc, r) => acc + r.amount, 0n);

  const grossPosted = sumOf('DONATION_GROSS');
  // 수수료는 음수로 기록되므로 부호를 뒤집어 "차감된 금액"으로 만든다.
  const platformFeePosted = -sumOf('PLATFORM_FEE');
  const alreadyReturned = sumOf('REFUND_FEE_RETURN');
  const alreadyRefunded = -sumOf('REFUND');

  if (grossPosted <= 0n || platformFeePosted <= 0n) {
    return { platformFeeReturn: 0n, grossPosted, platformFeePosted };
  }

  // 이번 환불까지 포함한 누적 환불 비율에 해당하는 환입액에서, 이미 환입한 금액을 뺀다.
  const cumulativeRefund = alreadyRefunded + refundAmount;
  const capped = cumulativeRefund > grossPosted ? grossPosted : cumulativeRefund;
  const targetReturn = (platformFeePosted * capped) / grossPosted;
  const platformFeeReturn = targetReturn - alreadyReturned;

  return {
    platformFeeReturn: platformFeeReturn < 0n ? 0n : platformFeeReturn,
    grossPosted,
    platformFeePosted,
  };
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
    // 원 거래 분개에서 환입액을 산출한다. (환불 시점 요율로 재계산하면 원장이 틀어진다)
    const { platformFeeReturn } = await resolveRefundFeeReturn(input.donationId, input.amount);
    if (platformFeeReturn > 0n) {
      entries.push({
        creatorId: input.creatorId, entryType: 'REFUND_FEE_RETURN', amount: platformFeeReturn,
        donationId: input.donationId, refundId: input.refundId, occurredAt: input.occurredAt,
        memo: '환불에 따른 플랫폼수수료 환입',
      });
    }
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
export interface CreateSettlementInput {
  memo?: string;
  /** 원천징수 신고용 주민등록번호(정규화된 13자리). 신고 후 파기된다. */
  resident?: string | null;
}

export async function createSettlementRequest(
  creatorId: string,
  amount: bigint,
  input: CreateSettlementInput = {},
) {
  if (amount <= 0n) throw new Error('정산 요청 금액이 올바르지 않습니다.');

  // 개인(사업소득 3.3% 원천징수) 크리에이터는 신고용 주민등록번호가 반드시 필요하다.
  const resident = input.resident ? normalizeResident(input.resident) : null;
  if (input.resident && !resident) throw new Error('주민등록번호 형식이 올바르지 않습니다.');

  return prisma.$transaction(async (tx) =>
    withAdvisoryLock(tx, `settlement:req:${creatorId}`, async () => {
      // 잠금 획득 후 읽어야 앞선 요청의 커밋 결과가 반영된 값을 본다
      const summary = await getSettlementSummary(creatorId);
      if (amount > summary.available) throw new Error('정산 가능 금액을 초과했습니다.');

      const account = await tx.settlementAccount.findUnique({ where: { creatorId } });
      if (!account || !account.verified) throw new Error('정산 계좌 인증이 완료되지 않았습니다.');

      // 원천징수 3.3% (사업소득 기준). 실제 적용은 세무 자문 후 확정한다.
      const withholding = applyRate(amount, WITHHOLDING_RATE);

      return tx.settlementRequest.create({
        data: {
          id: newId(),
          creatorId,
          amount,
          withholding,
          payoutAmount: amount - withholding,
          memo: input.memo ?? null,
          // 주민등록번호는 암호화 저장하고 화면에는 마스킹만 노출한다.
          residentEnc: resident ? encrypt(resident) : null,
          residentMasked: resident ? maskResident(resident) : null,
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
export async function markSettlementPaid(requestId: string, adminId?: string, payoutRef?: string) {
  return prisma.$transaction(async (tx) =>
    withAdvisoryLock(tx, `settlement:paid:${requestId}`, async () => {
      const req = await tx.settlementRequest.findUnique({ where: { id: requestId } });
      if (!req) throw new Error('정산 요청을 찾을 수 없습니다.');
      if (req.status === 'PAID') return req;

      // 잠금 안에서 다시 검증한다. 화면 단 검사만으로는 동시 클릭·상태 변경 경합을 막지 못한다.
      if (req.status !== 'APPROVED') {
        throw new Error('승인(APPROVED) 상태의 정산 요청만 지급 완료 처리할 수 있습니다.');
      }

      // 지급 직전 계좌 인증 재확인. 승인 이후 계좌가 바뀌거나 인증이 해제됐을 수 있다.
      const account = await tx.settlementAccount.findUnique({ where: { creatorId: req.creatorId } });
      if (!account || !account.verified) {
        throw new Error('정산 계좌 인증이 해제되어 지급할 수 없습니다. 계좌 실명확인 후 다시 시도해 주세요.');
      }

      // 지급 직전 잔액 재확인. 승인 이후 환불·조정이 발생해 잔액이 부족해졌을 수 있다.
      const summary = await getSettlementSummary(req.creatorId);
      if (req.amount > summary.balance) {
        throw new Error(
          `정산 가능 잔액이 부족합니다. (요청 ${req.amount.toString()}원 / 현재 잔액 ${summary.balance.toString()}원) 환불·조정 내역을 확인해 주세요.`,
        );
      }

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
        data: { status: 'PAID', paidAt: now, adminId: adminId ?? null, payoutRef: payoutRef ?? null },
      });
    }),
  );
}

/**
 * 지급 실패 처리.
 * 지급대행(쿠콘) 결과가 실패로 회신된 건을 처리한다.
 * 이미 PAID 로 원장에 기록됐다면 지급/원천징수 분개를 반대 부호로 환입해
 * 잔액이 되살아나게 하고, 재요청할 수 있도록 상태만 PAYOUT_FAILED 로 둔다.
 */
export async function markSettlementPayoutFailed(requestId: string, reason: string, adminId?: string) {
  return prisma.$transaction(async (tx) =>
    withAdvisoryLock(tx, `settlement:paid:${requestId}`, async () => {
      const req = await tx.settlementRequest.findUnique({ where: { id: requestId } });
      if (!req) throw new Error('정산 요청을 찾을 수 없습니다.');
      if (req.status === 'PAYOUT_FAILED') return req;
      if (req.status !== 'PAID' && req.status !== 'APPROVED') {
        throw new Error('지급 완료 또는 승인 상태의 요청만 지급 실패로 처리할 수 있습니다.');
      }

      const now = new Date();
      // 이미 지급 분개가 기록된 경우에만 환입한다.
      if (req.status === 'PAID') {
        await appendLedger(
          [
            {
              creatorId: req.creatorId, entryType: 'PAYOUT', amount: req.payoutAmount,
              requestId: req.id, occurredAt: now, memo: `지급 실패 환입: ${reason}`.slice(0, 200),
            },
            {
              creatorId: req.creatorId, entryType: 'PAYOUT_WITHHOLDING', amount: req.withholding,
              requestId: req.id, occurredAt: now, memo: '지급 실패 원천징수 환입',
            },
          ],
          tx,
        );
      }

      return tx.settlementRequest.update({
        where: { id: requestId },
        data: {
          status: 'PAYOUT_FAILED',
          payoutFailReason: reason.slice(0, 300),
          adminId: adminId ?? null,
        },
      });
    }),
  );
}

/**
 * 원천징수 지급명세서 신고 완료 처리 + 주민등록번호 파기.
 *
 * 지급명세서에 담긴 금액·원천징수·지급일 등 회계 기록은 세법상 보존 의무가 있어 그대로 남기고,
 * **주민등록번호 원문만** 즉시 삭제한다. 출금 신청 화면에서 안내한 "신고 후 파기" 를 실제로 이행한다.
 */
export async function fileWithholdingAndPurgeResident(requestId: string, adminId?: string) {
  const now = new Date();
  const req = await prisma.settlementRequest.findUnique({
    where: { id: requestId },
    select: { id: true, status: true, residentEnc: true, residentPurgedAt: true },
  });
  if (!req) throw new Error('정산 요청을 찾을 수 없습니다.');
  if (req.status !== 'PAID') throw new Error('지급 완료된 요청만 원천징수 신고 처리할 수 있습니다.');

  await prisma.settlementRequest.update({
    where: { id: requestId },
    data: {
      withholdingFiledAt: now,
      // 주민등록번호 원문만 파기한다. 마스킹·금액·원천징수 기록은 유지.
      residentEnc: null,
      residentPurgedAt: req.residentEnc ? now : req.residentPurgedAt ?? now,
      adminId: adminId ?? null,
    },
  });
  return { purged: Boolean(req.residentEnc) };
}

/** 지급대행 이체 파일 한 줄에 담기는 값. */
export interface PayoutRow {
  requestId: string;
  creatorName: string;
  creatorCode: string;
  bankCode: string;
  bankName: string;
  account: string;
  holder: string;
  amount: bigint;
  note: string;
}

/**
 * 승인 건을 지급대행(쿠콘) 이체 대상으로 변환한다.
 * 계좌번호·예금주는 암호화 저장돼 있으므로 여기서 복호화한다(파일 생성 목적).
 * 반환값은 그대로 CSV/엑셀로 만든다.
 */
export async function buildPayoutRows(requestIds: string[]): Promise<PayoutRow[]> {
  if (requestIds.length === 0) return [];
  const reqs = await prisma.settlementRequest.findMany({
    where: { id: { in: requestIds }, status: 'APPROVED' },
    select: {
      id: true, payoutAmount: true,
      creator: {
        select: {
          displayName: true, code: true,
          settlementAccount: {
            select: { bankCode: true, bankName: true, accountEnc: true, holderNameEnc: true, verified: true },
          },
        },
      },
    },
  });

  const rows: PayoutRow[] = [];
  for (const r of reqs) {
    const acc = r.creator.settlementAccount;
    if (!acc || !acc.verified) continue; // 미인증 계좌는 이체 대상에서 제외
    rows.push({
      requestId: r.id,
      creatorName: r.creator.displayName,
      creatorCode: r.creator.code,
      bankCode: acc.bankCode,
      bankName: acc.bankName,
      account: decrypt(acc.accountEnc),
      holder: decrypt(acc.holderNameEnc),
      amount: r.payoutAmount,
      note: `도네이도 정산 ${r.creator.code}`,
    });
  }
  return rows;
}
