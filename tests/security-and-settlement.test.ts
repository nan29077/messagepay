import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/server/db';
import { newId } from '@/lib/id';
import { resetDb, seedBasics, seedRegisteredDonor, moPayload, type Fixture } from './helpers';
import { handleMoInbound } from '@/server/services/donation-flow';
import { mockMoAdapter } from '@/server/adapters/mo';
import { resolvePolicy, checkLimits, FALLBACK_POLICY } from '@/server/services/limits';
import { resolveFeePolicy, resolveRefundFeeReturn, postRefundSettlement, getSettlementSummary } from '@/server/services/settlement';
import { generateNumericCode, randomCodeString } from '@/lib/crypto';
import { isSameOrigin } from '@/server/request-guard';
import { env } from '@/lib/env';

/**
 * 3단계(보안·금전 P1) 회귀 테스트.
 * 감사에서 지적된 항목을 "실제로 막히는지" 실행으로 확인한다.
 */

let fx: Fixture;

async function inbound(payload: Record<string, unknown>) {
  return handleMoInbound(mockMoAdapter.parse(payload));
}

beforeEach(async () => {
  await resetDb();
  fx = await seedBasics();
});

describe('정책 시행일(effectiveFrom / effectiveTo)', () => {
  it('시행일이 아직 오지 않은 한도 정책은 적용되지 않는다', async () => {
    // 기본 GLOBAL 정책(시행 중)의 값을 확인
    const before = await resolvePolicy(fx.creatorId, null);
    expect(before.maxAmount).not.toBe(1n);

    // 내일부터 시행되는 CREATOR 정책을 등록해도 오늘은 적용되면 안 된다.
    const tomorrow = new Date(Date.now() + 86_400_000);
    await prisma.donationLimitPolicy.create({
      data: {
        id: newId(), scope: 'CREATOR', creatorId: fx.creatorId,
        maxAmount: 1n, effectiveFrom: tomorrow,
      },
    });

    const after = await resolvePolicy(fx.creatorId, null);
    expect(after.maxAmount).toBe(before.maxAmount);

    // 시행일이 지난 시점으로 조회하면 새 정책이 적용된다.
    const later = await resolvePolicy(fx.creatorId, null, new Date(Date.now() + 2 * 86_400_000));
    expect(later.maxAmount).toBe(1n);
  });

  it('종료된(effectiveTo 경과) 한도 정책은 적용되지 않는다', async () => {
    await prisma.donationLimitPolicy.updateMany({
      where: { scope: 'GLOBAL' },
      data: { effectiveTo: new Date(Date.now() - 1000) },
    });
    const p = await resolvePolicy(fx.creatorId, null);
    // 유효한 정책이 하나도 없으면 안전한 기본값으로 떨어진다.
    expect(p.maxAmount).toBe(FALLBACK_POLICY.maxAmount);
  });

  it('시행 전 수수료 정책은 정산 계산에 쓰이지 않는다', async () => {
    const current = await resolveFeePolicy(fx.creatorId);
    expect(current?.platformFeeRate.toString()).toBe('0.15');

    await prisma.feePolicy.create({
      data: {
        id: newId(), scope: 'CREATOR', creatorId: fx.creatorId,
        pgFeeRate: '0.5', platformFeeRate: '0.5',
        effectiveFrom: new Date(Date.now() + 86_400_000),
      },
    });

    const stillCurrent = await resolveFeePolicy(fx.creatorId);
    expect(stillCurrent?.platformFeeRate.toString()).toBe('0.15');
  });
});

describe('속도 제한 카운터', () => {
  it('결제 직전 재검사는 속도 제한 카운터를 다시 소진하지 않는다', async () => {
    const donor = await seedRegisteredDonor(fx.donorPhone);
    await prisma.donationLimitPolicy.updateMany({ data: { velocityWindowSec: 3600, velocityMaxCount: 2 } });

    const args = { donor, creatorId: fx.creatorId, amount: 3000n };

    // 1건째: 소진 O
    expect((await checkLimits({ ...args })).ok).toBe(true);
    // 같은 건의 재검사: 소진 X (여기서 카운터가 올라가면 다음 정상 후원이 막힌다)
    expect((await checkLimits({ ...args, consumeVelocity: false })).ok).toBe(true);
    expect((await checkLimits({ ...args, consumeVelocity: false })).ok).toBe(true);

    // 2건째: 소진 O → 아직 한도 내
    expect((await checkLimits({ ...args })).ok).toBe(true);
    // 3건째: 한도 초과
    const third = await checkLimits({ ...args });
    expect(third.ok).toBe(false);
    expect(third.code).toBe('VELOCITY');
  });
});

describe('한도 집계 예약', () => {
  it('결제 성공 건은 집계에 한 번만 반영된다', async () => {
    await seedRegisteredDonor(fx.donorPhone);
    await inbound(moPayload({ to: fx.moNumber }));

    const day = await prisma.donationCounter.findFirstOrThrow({
      where: { creatorId: 'ALL', periodType: 'DAY' },
    });
    // 판정 트랜잭션에서 예약하고 승인 후 또 더하면 1건이 2건으로 세어진다.
    expect(day.count).toBe(1);
    expect(day.amount).toBe(3000n);
  });

  it('결제에 실패한 건은 집계에 남지 않는다', async () => {
    await seedRegisteredDonor(fx.donorPhone);
    // mock 어댑터: 금액 끝 999 = 승인 거절
    await prisma.creatorProfile.update({ where: { id: fx.creatorId }, data: { donationAmount: 2999n } });

    const res = await inbound(moPayload({ to: fx.moNumber }));
    expect(res.status).toBe('PAYMENT_FAILED');

    const counters = await prisma.donationCounter.findMany();
    // 예약분이 되돌아오지 않으면 실패한 후원이 그날 한도를 계속 잡아먹는다.
    expect(counters.every((c) => c.count === 0 && c.amount === 0n)).toBe(true);
  });
});

describe('환불 수수료 환입', () => {
  it('환불 시점에 수수료율이 바뀌어도 원 거래에 기록된 금액만큼만 환입한다', async () => {
    await seedRegisteredDonor(fx.donorPhone);
    const res = await inbound(moPayload({ to: fx.moNumber }));
    const donation = await prisma.donation.findFirstOrThrow({ where: { id: res.donationId } });
    expect(donation.paidAt).not.toBeNull();

    const posted = await prisma.settlementLedger.findMany({ where: { donationId: donation.id } });
    const platformFeePosted = -posted
      .filter((r) => r.entryType === 'PLATFORM_FEE')
      .reduce((a, r) => a + r.amount, 0n);
    expect(platformFeePosted).toBeGreaterThan(0n);

    // 결제 이후 플랫폼 수수료율을 50% 로 인상 (신규 거래에만 적용되어야 한다)
    await prisma.feePolicy.updateMany({ where: { scope: 'GLOBAL' }, data: { platformFeeRate: '0.5' } });

    const calc = await resolveRefundFeeReturn(donation.id, donation.amount);
    expect(calc.platformFeeReturn).toBe(platformFeePosted);
  });

  it('부분 환불을 반복해도 총 환입액이 원 차감액을 넘지 않는다', async () => {
    await seedRegisteredDonor(fx.donorPhone);
    const res = await inbound(moPayload({ to: fx.moNumber }));
    const donation = await prisma.donation.findFirstOrThrow({ where: { id: res.donationId } });

    const posted = await prisma.settlementLedger.findMany({ where: { donationId: donation.id } });
    const platformFeePosted = -posted
      .filter((r) => r.entryType === 'PLATFORM_FEE')
      .reduce((a, r) => a + r.amount, 0n);

    const half = donation.amount / 2n;
    const fees = { gross: donation.amount, pgFee: 0n, platformFee: 0n, net: 0n, pgFeeRate: '0', platformFeeRate: '0' };

    await postRefundSettlement({
      creatorId: fx.creatorId, donationId: donation.id, refundId: newId(), amount: half, fees,
    });
    await postRefundSettlement({
      creatorId: fx.creatorId, donationId: donation.id, refundId: newId(),
      amount: donation.amount - half, fees,
    });

    const returned = (await prisma.settlementLedger.findMany({ where: { donationId: donation.id } }))
      .filter((r) => r.entryType === 'REFUND_FEE_RETURN')
      .reduce((a, r) => a + r.amount, 0n);

    expect(returned).toBe(platformFeePosted);

    // 전액 환불 + 수수료 환입이면 이 거래의 정산 기여분은 PG 수수료만큼만 남는다(음수).
    const summary = await getSettlementSummary(fx.creatorId);
    const pgFeePosted = -posted.filter((r) => r.entryType === 'PG_FEE').reduce((a, r) => a + r.amount, 0n);
    expect(summary.balance).toBe(-pgFeePosted);
  });
});

describe('인증번호 난수', () => {
  it('6자리 인증번호는 CSPRNG 로 생성되며 앞자리가 0이 아니다', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      const c = generateNumericCode(6);
      expect(c).toMatch(/^[1-9]\d{5}$/);
      codes.add(c);
    }
    // 2000회 생성에서 사실상 전부 달라야 한다 (편향/짧은 주기 감지)
    expect(codes.size).toBeGreaterThan(1800);
  });

  it('크리에이터 코드 알파벳에 혼동 문자가 섞이지 않는다', () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let i = 0; i < 500; i += 1) {
      const s = randomCodeString(alphabet, 4);
      expect(s).toHaveLength(4);
      expect(s).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    }
  });
});

describe('로그인 CSRF (동일 출처 검사)', () => {
  const make = (headers: Record<string, string>) =>
    new Request(`${env.baseUrl}/api/auth/login`, { method: 'POST', headers });

  it('외부 사이트에서 온 요청은 거절한다', () => {
    expect(isSameOrigin(make({ origin: 'https://evil.example.com' }))).toBe(false);
    expect(isSameOrigin(make({ referer: 'https://evil.example.com/x' }))).toBe(false);
  });

  it('Origin·Referer 가 모두 없으면 거절한다 (fail-closed)', () => {
    expect(isSameOrigin(make({}))).toBe(false);
  });

  it('같은 출처 요청은 허용한다', () => {
    expect(isSameOrigin(make({ origin: env.baseUrl }))).toBe(true);
    expect(isSameOrigin(make({ referer: `${env.baseUrl}/login` }))).toBe(true);
  });
});
