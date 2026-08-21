import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { mockMoAdapter } from '@/server/adapters/mo';
import { readMockOutbox } from '@/server/adapters/mt';
import { handleMoInbound } from '@/server/services/donation-flow';
import { completeRegistration, revokePaymentMethod, startRegistration } from '@/server/services/donor-registration';
import { generateToken, tokenHash } from '@/lib/crypto';
import { moPayload, resetDb, seedBasics, seedRegisteredDonor, type Fixture } from './helpers';

let fx: Fixture;

async function inbound(payload: Record<string, unknown>) {
  return handleMoInbound(mockMoAdapter.parse(payload));
}

describe('전화번호별 내통장결제 가입 상태', () => {
  beforeEach(async () => {
    await resetDb();
    fx = await seedBasics({ paymentMode: 'DIRECT_TRIGGER' });
  });

  it('가입 전 MO가 겹쳐도 가입 링크 MT는 최초 1건만 발송한다', async () => {
    const results = await Promise.all([
      inbound(moPayload({ to: fx.moNumber, messageId: 'MO-ONBOARD-FIRST-1' })),
      inbound(moPayload({ to: fx.moNumber, messageId: 'MO-ONBOARD-FIRST-2' })),
      inbound(moPayload({ to: fx.moNumber, messageId: 'MO-ONBOARD-FIRST-3' })),
    ]);

    expect(results.every((result) => result.result === 'UNREGISTERED_DONOR')).toBe(true);
    expect(await prisma.donorProfile.count()).toBe(1);
    expect(await prisma.donation.count()).toBe(0);
    expect(await prisma.paymentTransaction.count()).toBe(0);
    expect(await prisma.secureLink.count({ where: { purpose: 'REGISTER_ACCOUNT' } })).toBe(1);
    expect(await prisma.mtOutboundMessage.count({ where: { templateCode: 'REGISTER_GUIDE' } })).toBe(1);
    expect(readMockOutbox(10).filter((message) => message.text.includes('계좌 등록과 이용 동의')).length).toBe(1);

    const donor = await prisma.donorProfile.findFirstOrThrow();
    expect(donor.onboardingStatus).toBe('LINK_SENT');
    expect(donor.registrationLinkSentAt).not.toBeNull();
  });

  it('최초 안내 후 가입을 마치면 다음 MO만 결제하고 성공 감사 MT를 발송한다', async () => {
    await inbound(moPayload({ to: fx.moNumber, messageId: 'MO-ONBOARD-GUIDE' }));
    await inbound(moPayload({ to: fx.moNumber, messageId: 'MO-ONBOARD-WAIT', text: '가입 대기 중 문자' }));
    expect(await prisma.donation.count()).toBe(0);
    expect(await prisma.mtOutboundMessage.count({ where: { templateCode: 'REGISTER_GUIDE' } })).toBe(1);

    const rawToken = generateToken(16);
    const link = await prisma.secureLink.findFirstOrThrow({ where: { purpose: 'REGISTER_ACCOUNT' } });
    await prisma.secureLink.update({ where: { id: link.id }, data: { tokenHash: tokenHash(rawToken) } });
    const consents = (['TERMS_SERVICE', 'PRIVACY', 'E_FINANCE', 'WITHDRAWAL_AGREE', 'AGE_CONFIRM'] as const).map(
      (type) => ({ type, agreed: true }),
    );
    const registration = await startRegistration({ token: rawToken, consents });
    await completeRegistration({
      token: rawToken,
      registrationId: registration.registrationId,
      providerPayload: {
        tid: 'MOCK-ONBOARD-REG',
        bankCode: '004',
        bankName: 'KB국민은행',
        account: '11122233344455',
      },
    });

    const donor = await prisma.donorProfile.findFirstOrThrow();
    expect(donor.onboardingStatus).toBe('REGISTERED');

    const paid = await inbound(moPayload({ to: fx.moNumber, messageId: 'MO-ONBOARD-PAID', text: '가입 후 후원' }));
    const donation = await prisma.donation.findUniqueOrThrow({ where: { id: paid.donationId } });
    expect(donation.paidAt).not.toBeNull();
    expect(await prisma.paymentTransaction.count({ where: { donationId: donation.id, status: 'APPROVED' } })).toBe(1);
    expect(await prisma.mtOutboundMessage.count({ where: { templateCode: 'REGISTER_GUIDE' } })).toBe(1);

    const success = await prisma.mtOutboundMessage.findFirstOrThrow({
      where: { donationId: donation.id, templateCode: 'DONATION_SUCCESS', status: 'SENT' },
    });
    expect(success.bodyMasked).toContain('010-****-5678님, 테스트크리에이터 크리에이터에게 3,000원이 후원되었습니다. 감사합니다.');
  });

  it('결제수단 해지 후에는 가입 링크를 재발송하거나 결제하지 않는다', async () => {
    const donor = await seedRegisteredDonor(fx.donorPhone);
    expect(await revokePaymentMethod(donor.id)).toBe(true);
    expect((await prisma.donorProfile.findUniqueOrThrow({ where: { id: donor.id } })).onboardingStatus).toBe('SUSPENDED');

    await inbound(moPayload({ to: fx.moNumber, messageId: 'MO-ONBOARD-SUSPENDED' }));
    expect(await prisma.donation.count()).toBe(0);
    expect(await prisma.paymentTransaction.count()).toBe(0);
    expect(await prisma.mtOutboundMessage.count({ where: { templateCode: 'REGISTER_GUIDE' } })).toBe(0);
    expect(await prisma.mtOutboundMessage.count({ where: { templateCode: 'ACCOUNT_INACTIVE' } })).toBe(1);
  });
});
