import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { mockMoAdapter } from '@/server/adapters/mo';
import { readMockOutbox } from '@/server/adapters/mt';
import { handleMoInbound } from '@/server/services/donation-flow';
import { startRegistration, completeRegistration } from '@/server/services/donor-registration';
import { computeFees, getSettlementSummary } from '@/server/services/settlement';
import { tplDonationSuccess, tplRegisterGuide } from '@/server/services/mt-templates';
import { resetDb, seedBasics, seedRegisteredDonor, moPayload, type Fixture } from './helpers';
import { generateToken, tokenHash } from '@/lib/crypto';

let fx: Fixture;

async function inbound(payload: Record<string, unknown>) {
  return handleMoInbound(mockMoAdapter.parse(payload));
}

/** 전역 수수료 정책을 이 테스트에서 쓰는 값으로 바꾼다. */
async function setGlobalFee(input: { pg: string; platform: string; vatIncluded: boolean }) {
  await prisma.feePolicy.updateMany({
    where: { scope: 'GLOBAL' },
    data: { pgFeeRate: input.pg, platformFeeRate: input.platform, vatIncluded: input.vatIncluded },
  });
}

const CONSENTS = (['TERMS_SERVICE', 'PRIVACY', 'E_FINANCE', 'WITHDRAWAL_AGREE', 'AGE_CONFIRM'] as const).map(
  (type) => ({ type, agreed: true }),
);

/** 발송된 등록 링크의 토큰을 테스트가 아는 값으로 바꿔 돌려준다. */
async function takeRegisterToken() {
  const raw = generateToken(16);
  const link = await prisma.secureLink.findFirstOrThrow({ where: { purpose: 'REGISTER_ACCOUNT' } });
  await prisma.secureLink.update({ where: { id: link.id }, data: { tokenHash: tokenHash(raw) } });
  return raw;
}

describe('수수료 부가세 계산', () => {
  it('부가세 별도(vatIncluded=false)면 수수료의 10% 가 추가로 차감된다', () => {
    const fees = computeFees(3_000n, { pgFeeRate: '0', platformFeeRate: '0.10', vatIncluded: false });

    expect(fees.platformFeeSupply).toBe(300n); // 3,000 x 10%
    expect(fees.platformFeeVat).toBe(30n); // 300 x 10%
    expect(fees.platformFee).toBe(330n); // 총 차감
    expect(fees.vat).toBe(30n);
    expect(fees.net).toBe(2_670n); // 크리에이터 정산금
  });

  it('부가세 포함(vatIncluded=true)이면 요율만큼만 차감한다', () => {
    const fees = computeFees(3_000n, { pgFeeRate: '0', platformFeeRate: '0.10', vatIncluded: true });

    expect(fees.platformFee).toBe(300n);
    expect(fees.platformFeeVat).toBe(0n);
    expect(fees.vat).toBe(0n);
    expect(fees.net).toBe(2_700n);
  });

  it('결제수수료에도 같은 규칙이 적용되고 정산금은 두 수수료의 차액이다', () => {
    const fees = computeFees(10_000n, { pgFeeRate: '0.018', platformFeeRate: '0.15', vatIncluded: false });

    expect(fees.pgFeeSupply).toBe(180n);
    expect(fees.pgFeeVat).toBe(18n);
    expect(fees.platformFeeSupply).toBe(1_500n);
    expect(fees.platformFeeVat).toBe(150n);
    expect(fees.vat).toBe(168n);
    expect(fees.net).toBe(10_000n - 198n - 1_650n);
  });

  it('고정비(pgFixedFee)도 공급가액에 포함해 부가세를 계산한다', () => {
    const fees = computeFees(3_000n, {
      pgFeeRate: '0',
      pgFixedFee: 100n,
      platformFeeRate: '0',
      vatIncluded: false,
    });

    expect(fees.pgFeeSupply).toBe(100n);
    expect(fees.pgFeeVat).toBe(10n);
    expect(fees.net).toBe(2_890n);
  });
});

describe('부가세가 실제 후원·정산에 반영된다', () => {
  beforeEach(async () => {
    await resetDb();
    fx = await seedBasics({ paymentMode: 'DIRECT_TRIGGER' });
  });

  it('부가세 별도 정책이면 후원 1건의 정산금과 원장 잔액이 2,670원이 된다', async () => {
    await setGlobalFee({ pg: '0', platform: '0.10', vatIncluded: false });
    await seedRegisteredDonor(fx.donorPhone);

    const res = await inbound(moPayload({ to: fx.moNumber }));
    const donation = await prisma.donation.findFirstOrThrow({ where: { id: res.donationId } });

    expect(donation.platformFee).toBe(330n); // 300 + 부가세 30
    expect(donation.feeVat).toBe(30n);
    expect(donation.netAmount).toBe(2_670n);

    const summary = await getSettlementSummary(fx.creatorId);
    expect(summary.totalGross).toBe(3_000n);
    expect(summary.totalPlatformFee).toBe(330n);
    expect(summary.balance).toBe(2_670n);

    // 부가세 금액은 수수료 분개 메모에 남아 사후 대사가 가능하다.
    const platformEntry = await prisma.settlementLedger.findFirstOrThrow({
      where: { donationId: donation.id, entryType: 'PLATFORM_FEE' },
    });
    expect(platformEntry.memo).toContain('부가세 30원');
  });

  it('부가세 포함 정책이면 종전과 같이 요율만큼만 차감된다', async () => {
    await setGlobalFee({ pg: '0', platform: '0.10', vatIncluded: true });
    await seedRegisteredDonor(fx.donorPhone);

    const res = await inbound(moPayload({ to: fx.moNumber }));
    const donation = await prisma.donation.findFirstOrThrow({ where: { id: res.donationId } });

    expect(donation.platformFee).toBe(300n);
    expect(donation.feeVat).toBe(0n);
    expect(donation.netAmount).toBe(2_700n);
  });
});

describe('크리에이터 감사 문자 커스터마이즈', () => {
  beforeEach(async () => {
    await resetDb();
    fx = await seedBasics({ paymentMode: 'DIRECT_TRIGGER' });
  });

  it('설정이 없으면 기본 문구로 발송된다', async () => {
    await seedRegisteredDonor(fx.donorPhone);
    await inbound(moPayload({ to: fx.moNumber, text: '화이팅' }));

    const success = readMockOutbox(10).find((m) => m.text.includes('후원되었습니다'));
    expect(success?.text).toContain('누적 후원');
  });

  it('설정한 본문의 치환자가 실제 값으로 바뀌어 발송된다', async () => {
    await prisma.creatorProfile.update({
      where: { id: fx.creatorId },
      data: { thanksMtMessage: '{후원자}님 고마워요! {금액} 잘 받았습니다. 남겨주신 말: {메시지}' },
    });
    await seedRegisteredDonor(fx.donorPhone);
    await inbound(moPayload({ to: fx.moNumber, text: '오늘도 화이팅' }));

    const success = readMockOutbox(10).find((m) => m.text.includes('고마워요'));
    expect(success).toBeDefined();
    expect(success!.text).toBe(
      '[문자페이] 테스트후원자님 고마워요! 3,000원 잘 받았습니다. 남겨주신 말: 오늘도 화이팅',
    );
    // 발신 주체 표기는 설정과 무관하게 항상 붙는다.
    expect(success!.text.startsWith('[문자페이] ')).toBe(true);
    // 기본 문구는 더 이상 쓰이지 않는다.
    expect(success!.text).not.toContain('누적 후원');
  });

  it('치환값에 정규식 특수문자가 있어도 본문이 깨지지 않는다', () => {
    const dollar = '$';
    const out = tplDonationSuccess({
      donorName: `${dollar}&test`,
      creatorName: '문자페이',
      amount: 3_000n,
      message: `${dollar}1`,
      cumulative: 3_000n,
      custom: '{후원자} / {메시지}',
    });
    expect(out.text).toBe(`[문자페이] ${dollar}&test / ${dollar}1`);
  });

  it('설정이 공백뿐이면 기본 문구로 되돌아간다', () => {
    const out = tplDonationSuccess({
      donorName: '홍길동',
      creatorName: '문자페이',
      amount: 3_000n,
      message: '안녕',
      cumulative: 3_000n,
      custom: '   ',
    });
    expect(out.text).toContain('누적 후원');
  });
});

describe('카드 빌링키 구조', () => {
  beforeEach(async () => {
    await resetDb();
    fx = await seedBasics({ paymentMode: 'DIRECT_TRIGGER' });
  });

  it('카드로 등록하면 카드 빌링키가 저장되고 이후 후원 흐름은 계좌와 동일하게 동작한다', async () => {
    // (1) 최초 문자 -> 등록 안내 링크 발송 (결제수단 종류와 무관하게 같은 경로)
    const first = await inbound(moPayload({ to: fx.moNumber }));
    expect(first.result).toBe('UNREGISTERED_DONOR');

    // (2) 카드로 등록
    const raw = await takeRegisterToken();
    const started = await startRegistration({ token: raw, consents: CONSENTS, method: 'CARD' });
    const registration = await prisma.paymentRegistration.findUniqueOrThrow({
      where: { id: started.registrationId },
    });
    expect(registration.method).toBe('CARD');

    const done = await completeRegistration({
      token: raw,
      registrationId: started.registrationId,
      providerPayload: { tid: 'MOCKREG-CARD', card: '4111111111119876', cardIssuer: '테스트카드' },
    });
    expect(done.method).toBe('CARD');
    expect(done.cardTail4).toBe('9876');

    const token = await prisma.paymentMethodToken.findFirstOrThrow({ where: { donorId: done.donorId } });
    expect(token.method).toBe('CARD');
    expect(token.cardIssuer).toBe('테스트카드');
    expect(token.cardTail4).toBe('9876');
    expect(token.accountTail4).toBeNull();
    // 카드번호 원문은 저장하지 않는다.
    expect(JSON.stringify(token)).not.toContain('4111111111119876');

    // (3) 등록 후 문자는 결제수단 종류와 무관하게 후원으로 접수·결제된다.
    const second = await inbound(moPayload({ to: fx.moNumber, text: '카드로 후원합니다' }));
    expect(second.result).toBe('ROUTED');
    const donation = await prisma.donation.findFirstOrThrow({ where: { id: second.donationId } });
    expect(donation.paidAt).not.toBeNull();

    // (4) 감사 문자도 동일하게 발송된다.
    expect(readMockOutbox(10).some((m) => m.text.includes('후원되었습니다'))).toBe(true);
  });

  it('계좌로 등록하면 method 는 ACCOUNT 로 남는다 (기본값 유지)', async () => {
    await inbound(moPayload({ to: fx.moNumber }));
    const raw = await takeRegisterToken();
    const started = await startRegistration({ token: raw, consents: CONSENTS });

    const done = await completeRegistration({
      token: raw,
      registrationId: started.registrationId,
      providerPayload: { tid: 'MOCKREG-ACC', bankCode: '004', bankName: 'KB국민은행', account: '11122233344455' },
    });
    expect(done.method).toBe('ACCOUNT');
    expect(done.accountTail4).toBe('4455');

    const token = await prisma.paymentMethodToken.findFirstOrThrow({ where: { donorId: done.donorId } });
    expect(token.method).toBe('ACCOUNT');
    expect(token.cardTail4).toBeNull();
  });

  it('등록 안내 문자는 결제수단에 따라 문구만 달라진다', () => {
    expect(tplRegisterGuide('문자페이', 'https://x.test/r/abc').text).toContain('계좌 등록과 이용 동의');
    expect(tplRegisterGuide('문자페이', 'https://x.test/r/abc', 'CARD').text).toContain('카드 등록과 이용 동의');
  });
});
