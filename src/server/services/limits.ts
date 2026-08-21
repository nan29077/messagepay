import { prisma } from '@/server/db';
import { kv } from '@/server/redis';
import { newId } from '@/lib/id';
import { kstDateKey, kstMonthKey } from '@/lib/datetime';
import type { DonorProfileModel as DonorProfile } from '@/generated/prisma/models';

/** 전체 합계 행 센티널 */
export const ALL = 'ALL';

/**
 * 한도 / 이상거래 정책 엔진.
 * 정책 우선순위: DONOR > CREATOR > GLOBAL
 */

export interface EffectivePolicy {
  defaultAmount: bigint;
  minAmount: bigint;
  maxAmount: bigint;
  donorDailyLimit: bigint;
  donorMonthlyLimit: bigint;
  perCreatorDailyLimit: bigint;
  /** 1인(후원자) 1일 최대 후원 건수 */
  donorDailyMaxCount: number;
  velocityWindowSec: number;
  velocityMaxCount: number;
  cooldownAfterCount: number;
  cooldownSec: number;
  failureLockThreshold: number;
  newDonorFirstDayLimit: bigint;
  manualReviewAmount: bigint;
  ttsMinAmount: bigint;
}

export const FALLBACK_POLICY: EffectivePolicy = {
  defaultAmount: 3000n,
  minAmount: 1000n,
  maxAmount: 50000n,
  donorDailyLimit: 100000n,
  donorMonthlyLimit: 1000000n,
  perCreatorDailyLimit: 50000n,
  donorDailyMaxCount: 30,
  velocityWindowSec: 60,
  velocityMaxCount: 3,
  cooldownAfterCount: 5,
  cooldownSec: 300,
  failureLockThreshold: 3,
  newDonorFirstDayLimit: 30000n,
  manualReviewAmount: 200000n,
  ttsMinAmount: 3000n,
};

type PolicyRow = {
  defaultAmount: bigint; minAmount: bigint; maxAmount: bigint;
  donorDailyLimit: bigint; donorMonthlyLimit: bigint; perCreatorDailyLimit: bigint;
  donorDailyMaxCount: number; velocityWindowSec: number; velocityMaxCount: number; cooldownAfterCount: number; cooldownSec: number;
  failureLockThreshold: number; newDonorFirstDayLimit: bigint; manualReviewAmount: bigint; ttsMinAmount: bigint;
};

function pick(row: PolicyRow): EffectivePolicy {
  return {
    defaultAmount: row.defaultAmount,
    minAmount: row.minAmount,
    maxAmount: row.maxAmount,
    donorDailyLimit: row.donorDailyLimit,
    donorMonthlyLimit: row.donorMonthlyLimit,
    perCreatorDailyLimit: row.perCreatorDailyLimit,
    donorDailyMaxCount: row.donorDailyMaxCount,
    velocityWindowSec: row.velocityWindowSec,
    velocityMaxCount: row.velocityMaxCount,
    cooldownAfterCount: row.cooldownAfterCount,
    cooldownSec: row.cooldownSec,
    failureLockThreshold: row.failureLockThreshold,
    newDonorFirstDayLimit: row.newDonorFirstDayLimit,
    manualReviewAmount: row.manualReviewAmount,
    ttsMinAmount: row.ttsMinAmount,
  };
}

export async function resolvePolicy(
  creatorId?: string | null,
  donorId?: string | null,
  now: Date = new Date(),
): Promise<EffectivePolicy> {
  const rows = await prisma.donationLimitPolicy.findMany({
    where: {
      active: true,
      // 시행일이 아직 오지 않았거나 이미 종료된 정책은 적용하지 않는다.
      // (예약 등록한 미래 정책이 곧바로 적용돼 한도가 바뀌는 사고를 막는다)
      effectiveFrom: { lte: now },
      OR: [
        { scope: 'GLOBAL' },
        ...(creatorId ? [{ scope: 'CREATOR' as const, creatorId }] : []),
        ...(donorId ? [{ scope: 'DONOR' as const, donorId }] : []),
      ],
      AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }],
    },
    orderBy: { effectiveFrom: 'desc' },
  });

  const byScope = (s: 'GLOBAL' | 'CREATOR' | 'DONOR') => rows.find((r) => r.scope === s);
  const chosen = byScope('DONOR') ?? byScope('CREATOR') ?? byScope('GLOBAL');
  return chosen ? pick(chosen as unknown as PolicyRow) : FALLBACK_POLICY;
}

export type LimitDenyCode =
  | 'AMOUNT_RANGE'
  | 'DONOR_DAILY'
  | 'DONOR_DAILY_COUNT'
  | 'DONOR_MONTHLY'
  | 'CREATOR_DAILY'
  | 'VELOCITY'
  | 'COOLDOWN'
  | 'LOCKED'
  | 'BLOCKED'
  | 'NEW_DONOR_FIRST_DAY';

export interface LimitCheckResult {
  ok: boolean;
  code?: LimitDenyCode;
  message?: string;
  requiresManualReview: boolean;
  policy: EffectivePolicy;
}

export interface LimitCheckInput {
  donor: Pick<DonorProfile, 'id' | 'dailyLimit' | 'monthlyLimit' | 'lockedUntil' | 'blockedAt' | 'firstSeenAt'>;
  creatorId: string;
  amount: bigint;
  now?: Date;
  /** 크리에이터가 이 후원자를 차단했는지 */
  blockedByCreator?: boolean;
  /**
   * 속도 제한(velocity/streak) 카운터를 이번 호출에서 소진할지 여부. 기본 true.
   *
   * 같은 후원 1건에 대해 checkLimits 를 두 번 호출하는 경로(접수 시 + 결제 직전 재검사)에서는
   * 두 번째 호출을 false 로 둬야 한다. 그렇지 않으면 1건이 2건으로 계산돼
   * 설정한 속도 제한의 절반에서 정상 후원자가 차단되고 쿨다운도 두 배 빨리 걸린다.
   */
  consumeVelocity?: boolean;
}

async function readCounter(donorId: string, creatorId: string, periodType: string, periodKey: string) {
  const row = await prisma.donationCounter.findUnique({
    where: {
      donorId_creatorId_periodType_periodKey: { donorId, creatorId, periodType, periodKey },
    },
  });
  return { count: row?.count ?? 0, amount: row?.amount ?? 0n };
}

export async function checkLimits(input: LimitCheckInput): Promise<LimitCheckResult> {
  const now = input.now ?? new Date();
  const policy = await resolvePolicy(input.creatorId, input.donor.id, now);

  const donorDaily = input.donor.dailyLimit ?? policy.donorDailyLimit;
  const donorMonthly = input.donor.monthlyLimit ?? policy.donorMonthlyLimit;

  const deny = (code: LimitDenyCode, message: string): LimitCheckResult => ({
    ok: false, code, message, requiresManualReview: false, policy,
  });

  if (input.blockedByCreator) return deny('BLOCKED', '크리에이터가 차단한 후원자입니다.');
  if (input.donor.blockedAt) return deny('BLOCKED', '이용이 제한된 후원자입니다.');
  if (input.donor.lockedUntil && input.donor.lockedUntil > now) {
    return deny('LOCKED', '결제 실패가 반복되어 일시적으로 잠겼습니다. 관리자 해제가 필요합니다.');
  }
  // 허용 범위 = 플랫폼 한도 정책 ∩ 크리에이터가 후원샵 설정에서 정한 범위.
  // 크리에이터 설정을 보지 않으면, 후원자가 문자로 금액을 지정했을 때
  // 크리에이터가 정한 상·하한을 그냥 넘어가 버린다.
  const creatorRange = await prisma.creatorProfile.findUnique({
    where: { id: input.creatorId },
    select: { minAmount: true, maxAmount: true },
  });
  const effMin =
    creatorRange && creatorRange.minAmount > policy.minAmount ? creatorRange.minAmount : policy.minAmount;
  const effMax =
    creatorRange && creatorRange.maxAmount < policy.maxAmount ? creatorRange.maxAmount : policy.maxAmount;

  if (input.amount < effMin || input.amount > effMax) {
    return deny('AMOUNT_RANGE', `후원금은 ${effMin}원 ~ ${effMax}원 사이여야 합니다.`);
  }

  const dayKey = kstDateKey(now);
  const monthKey = kstMonthKey(now);

  const donorDay = await readCounter(input.donor.id, ALL, 'DAY', dayKey);
  if (donorDay.amount + input.amount > donorDaily) {
    return deny('DONOR_DAILY', '일일 후원 한도를 초과했습니다.');
  }

  // 1인 1일 최대 건수 (금액과 별개로 건수 자체를 제한)
  if (donorDay.count + 1 > policy.donorDailyMaxCount) {
    return deny('DONOR_DAILY_COUNT', `하루 최대 ${policy.donorDailyMaxCount}건까지 후원할 수 있습니다.`);
  }

  const donorMonth = await readCounter(input.donor.id, ALL, 'MONTH', monthKey);
  if (donorMonth.amount + input.amount > donorMonthly) {
    return deny('DONOR_MONTHLY', '월간 후원 한도를 초과했습니다.');
  }

  const creatorDay = await readCounter(input.donor.id, input.creatorId, 'DAY', dayKey);
  if (creatorDay.amount + input.amount > policy.perCreatorDailyLimit) {
    return deny('CREATOR_DAILY', '해당 크리에이터에 대한 일일 한도를 초과했습니다.');
  }

  // 신규 후원자 첫날 한도
  if (kstDateKey(input.donor.firstSeenAt) === dayKey && donorDay.amount + input.amount > policy.newDonorFirstDayLimit) {
    return deny('NEW_DONOR_FIRST_DAY', '신규 후원자 첫날 한도를 초과했습니다.');
  }

  // 연속 발송 대기(cooldown) 확인
  const cooldownKey = `cooldown:${input.donor.id}`;
  if (await kv.get(cooldownKey)) {
    return deny('COOLDOWN', '연속 발송으로 대기 중입니다. 잠시 후 다시 시도해 주세요.');
  }

  if (input.consumeVelocity !== false) {
    // 속도 제한: window 내 최대 건수
    const velocityKey = `velocity:${input.donor.id}:${Math.floor(now.getTime() / (policy.velocityWindowSec * 1000))}`;
    const vCount = await kv.incr(velocityKey, policy.velocityWindowSec);
    if (vCount > policy.velocityMaxCount) {
      return deny('VELOCITY', `${policy.velocityWindowSec}초 내 최대 ${policy.velocityMaxCount}건까지 후원할 수 있습니다.`);
    }

    // 연속 N건 이후 쿨다운 부여
    const streakKey = `streak:${input.donor.id}`;
    const streak = await kv.incr(streakKey, policy.cooldownSec);
    if (streak >= policy.cooldownAfterCount) {
      await kv.set(cooldownKey, '1', policy.cooldownSec);
      await kv.del(streakKey);
    }
  }

  return {
    ok: true,
    requiresManualReview: input.amount >= policy.manualReviewAmount,
    policy,
  };
}

/** 결제 성공 시 집계 반영 */
export async function commitCounters(donorId: string, creatorId: string, amount: bigint, now = new Date()) {
  const dayKey = kstDateKey(now);
  const monthKey = kstMonthKey(now);
  const targets: Array<{ creatorId: string; periodType: string; periodKey: string }> = [
    { creatorId: ALL, periodType: 'DAY', periodKey: dayKey },
    { creatorId: ALL, periodType: 'MONTH', periodKey: monthKey },
    { creatorId, periodType: 'DAY', periodKey: dayKey },
    { creatorId, periodType: 'MONTH', periodKey: monthKey },
  ];

  for (const t of targets) {
    await prisma.donationCounter.upsert({
      where: {
        donorId_creatorId_periodType_periodKey: {
          donorId, creatorId: t.creatorId, periodType: t.periodType, periodKey: t.periodKey,
        },
      },
      create: {
        id: newId(), donorId, creatorId: t.creatorId,
        periodType: t.periodType, periodKey: t.periodKey, count: 1, amount,
      },
      update: { count: { increment: 1 }, amount: { increment: amount } },
    });
  }
}

/** 환불 시 집계 되돌림 */
export async function rollbackCounters(donorId: string, creatorId: string, amount: bigint, at: Date) {
  const dayKey = kstDateKey(at);
  const monthKey = kstMonthKey(at);
  const targets: Array<{ creatorId: string; periodType: string; periodKey: string }> = [
    { creatorId: ALL, periodType: 'DAY', periodKey: dayKey },
    { creatorId: ALL, periodType: 'MONTH', periodKey: monthKey },
    { creatorId, periodType: 'DAY', periodKey: dayKey },
    { creatorId, periodType: 'MONTH', periodKey: monthKey },
  ];
  for (const t of targets) {
    await prisma.donationCounter.updateMany({
      where: { donorId, creatorId: t.creatorId, periodType: t.periodType, periodKey: t.periodKey },
      data: { count: { decrement: 1 }, amount: { decrement: amount } },
    });
  }
}

export async function registerFailure(donorId: string, threshold: number) {
  const donor = await prisma.donorProfile.update({
    where: { id: donorId },
    data: { failCount: { increment: 1 } },
  });
  if (donor.failCount >= threshold) {
    await prisma.donorProfile.update({
      where: { id: donorId },
      // 관리자 해제 전까지 잠금 (충분히 먼 미래)
      data: { lockedUntil: new Date(Date.now() + 365 * 86_400_000) },
    });
    return true;
  }
  return false;
}

export async function clearFailures(donorId: string) {
  await prisma.donorProfile.update({ where: { id: donorId }, data: { failCount: 0 } });
}
