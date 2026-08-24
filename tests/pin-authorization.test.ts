import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { mockMoAdapter } from '@/server/adapters/mo';
import { readMockOutbox } from '@/server/adapters/mt';
import { handleMoInbound, resolveConfirmChannel, startPinAuthorization } from '@/server/services/donation-flow';
import { completePinAuthorization, expireStalePinSessions } from '@/server/services/pin-authorization';
import { resetDb, seedBasics, seedRegisteredDonor, moPayload, type Fixture } from './helpers';

/**
 * PIN 인증 결제 흐름.
 *
 *   MO 수신 → (빌키 있음) 후원 생성 → 결제사 PIN 링크 발급 → MT 발송
 *   → 후원자 PIN 입력 → 콜백 → 승인 → 정산 분개 → 방송
 *
 * 이 파일이 지키는 것
 *  1) MO 수신·PIN 링크 발송만으로는 절대 출금되지 않는다.
 *  2) 콜백이 몇 번 오든 결제는 한 번만 일어난다.
 *  3) 만료된 인증으로는 결제되지 않는다.
 */

let fx: Fixture;

async function inbound(payload: Record<string, unknown>) {
  return handleMoInbound(mockMoAdapter.parse(payload));
}

describe('PIN 인증 결제 흐름 (CONFIRM_LINK 기본 경로)', () => {
  beforeEach(async () => {
    await resetDb();
    // 기본값(플래그 미설정)이 PIN 경로다.
    delete process.env.ALLOW_LEGACY_CONFIRM_LINK;
    fx = await seedBasics({ paymentMode: 'CONFIRM_LINK' });
  });

  afterEach(() => {
    delete process.env.ALLOW_LEGACY_CONFIRM_LINK;
  });

  it('플래그가 없으면 PIN 경로를 탄다', () => {
    expect(resolveConfirmChannel()).toBe('PIN');
  });

  it('[1] 미등록 팬의 MO 는 결제되지 않고 등록 안내만 발송된다', async () => {
    const res = await inbound(moPayload({ to: fx.moNumber, text: '첫 후원입니다' }));

    expect(res.result).toBe('UNREGISTERED_DONOR');
    expect(await prisma.donation.count()).toBe(0);
    expect(await prisma.paymentPinSession.count()).toBe(0);
    expect(await prisma.paymentTransaction.count()).toBe(0);

    const mt = readMockOutbox(1)[0];
    expect(mt.text).toContain('최초 문자는 후원 처리되지 않았습니다');
    expect(await prisma.secureLink.count({ where: { purpose: 'REGISTER_ACCOUNT' } })).toBe(1);
  });

  it('[2] 등록 팬의 MO 는 PIN 링크만 발송되고 출금은 일어나지 않는다', async () => {
    await seedRegisteredDonor(fx.donorPhone);
    const res = await inbound(moPayload({ to: fx.moNumber }));

    expect(res.status).toBe('PENDING_PIN');
    // 승인 단계로 넘어가지 않았다 = 출금 없음
    expect(await prisma.paymentTransaction.count()).toBe(0);
    expect(await prisma.settlementLedger.count()).toBe(0);

    const session = await prisma.paymentPinSession.findFirstOrThrow();
    expect(session.status).toBe('PENDING');
    expect(session.donationId).toBe(res.donationId);
    expect(session.amount).toBe(3000n);
    // 계약 전 mock 발급임이 기록된다
    expect(session.mock).toBe(true);
    // 링크 원문은 저장하지 않는다
    expect(session.pinUrlMasked).not.toContain(session.sessionId);

    const mt = readMockOutbox(3).find((m) => m.text.includes('PIN'));
    expect(mt).toBeDefined();
    expect(mt!.text).toContain('[MOCK]');
    expect(mt!.text).toContain('아직 결제되지 않았습니다');
    expect(mt!.text).toContain(session.sessionId);

    // 문자 이력에는 링크가 마스킹되어 남는다
    const row = await prisma.mtOutboundMessage.findFirstOrThrow({ where: { templateCode: 'PIN_REQUEST' } });
    expect(row.bodyMasked).toContain('[보안링크]');
    expect(row.bodyMasked).not.toContain(session.sessionId);
  });

  it('[3] PIN 완료 콜백을 받아야 결제가 완료되고 정산 원장이 생긴다', async () => {
    await seedRegisteredDonor(fx.donorPhone);
    const res = await inbound(moPayload({ to: fx.moNumber, text: '오늘 방송 최고예요' }));
    const session = await prisma.paymentPinSession.findFirstOrThrow();

    const done = await completePinAuthorization({ sessionId: session.sessionId });
    expect(done.ok).toBe(true);
    expect(done.code).toBe('OK');

    const donation = await prisma.donation.findFirstOrThrow({ where: { id: res.donationId } });
    expect(donation.paidAt).not.toBeNull();
    expect([
      'PAYMENT_SUCCESS',
      'BROADCAST_PENDING',
      'BROADCASTED',
      'PARTIAL_DELIVERY_FAILED',
      'SETTLEMENT_PENDING',
    ]).toContain(donation.status);

    expect(await prisma.paymentTransaction.count({ where: { status: 'APPROVED' } })).toBe(1);
    // 정산 원장 3분개 (수입 / 수수료 / 지급대기)
    expect(await prisma.settlementLedger.count({ where: { donationId: res.donationId } })).toBe(3);

    const after = await prisma.paymentPinSession.findFirstOrThrow();
    expect(after.status).toBe('COMPLETED');
    expect(after.completedAt).not.toBeNull();
    expect(after.callbackCount).toBe(1);

    // 완료 안내 문자
    expect(readMockOutbox(5).some((m) => m.text.includes('후원'))).toBe(true);
  });

  it('[4] 콜백이 중복으로 와도 결제는 1회만 이루어진다', async () => {
    await seedRegisteredDonor(fx.donorPhone);
    const res = await inbound(moPayload({ to: fx.moNumber }));
    const session = await prisma.paymentPinSession.findFirstOrThrow();

    const first = await completePinAuthorization({ sessionId: session.sessionId });
    const second = await completePinAuthorization({ sessionId: session.sessionId });
    const third = await completePinAuthorization({ donationId: res.donationId });

    expect(first.code).toBe('OK');
    expect(second.code).toBe('DUPLICATE');
    expect(third.code).toBe('DUPLICATE');

    expect(await prisma.paymentTransaction.count({ where: { status: 'APPROVED' } })).toBe(1);
    expect(await prisma.settlementLedger.count({ where: { donationId: res.donationId } })).toBe(3);

    const session2 = await prisma.paymentPinSession.findFirstOrThrow();
    expect(session2.callbackCount).toBe(3);
  });

  it('[5] 동시에 도착한 콜백 2건도 결제는 1회만 이루어진다', async () => {
    await seedRegisteredDonor(fx.donorPhone);
    const res = await inbound(moPayload({ to: fx.moNumber }));
    const session = await prisma.paymentPinSession.findFirstOrThrow();

    const [a, b] = await Promise.all([
      completePinAuthorization({ sessionId: session.sessionId }),
      completePinAuthorization({ sessionId: session.sessionId }),
    ]);

    expect([a.code, b.code]).toContain('OK');
    expect(await prisma.paymentTransaction.count({ where: { status: 'APPROVED' } })).toBe(1);
    expect(await prisma.settlementLedger.count({ where: { donationId: res.donationId } })).toBe(3);
  });

  it('[6] PIN 을 입력하지 않으면 만료 배치가 자동 취소한다', async () => {
    await seedRegisteredDonor(fx.donorPhone);
    const res = await inbound(moPayload({ to: fx.moNumber }));

    await prisma.paymentPinSession.updateMany({
      where: { status: 'PENDING' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const expired = await expireStalePinSessions();
    expect(expired).toBe(1);

    const donation = await prisma.donation.findFirstOrThrow({ where: { id: res.donationId } });
    expect(donation.status).toBe('PAYMENT_FAILED');
    expect(await prisma.paymentTransaction.count()).toBe(0);
    expect(await prisma.settlementLedger.count()).toBe(0);

    // 두 번 돌려도 같은 건을 다시 세지 않는다
    expect(await expireStalePinSessions()).toBe(0);
  });

  it('[7] 만료된 뒤 도착한 콜백으로는 결제되지 않는다', async () => {
    await seedRegisteredDonor(fx.donorPhone);
    await inbound(moPayload({ to: fx.moNumber }));
    const session = await prisma.paymentPinSession.findFirstOrThrow();

    await prisma.paymentPinSession.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const late = await completePinAuthorization({ sessionId: session.sessionId });
    expect(late.ok).toBe(false);
    expect(late.code).toBe('EXPIRED');
    expect(await prisma.paymentTransaction.count()).toBe(0);

    const donation = await prisma.donation.findFirstOrThrow();
    expect(donation.status).toBe('PAYMENT_FAILED');
  });

  it('[8] 존재하지 않는 세션의 콜백은 아무 것도 하지 않는다', async () => {
    const res = await completePinAuthorization({ sessionId: 'NO-SUCH-SESSION' });
    expect(res.ok).toBe(false);
    expect(res.code).toBe('NOT_FOUND');
    expect(await prisma.paymentTransaction.count()).toBe(0);
  });

  it('[9] PIN 링크 발급에 실패하면 결제 실패로 확정하고 안내한다', async () => {
    // mock 규칙: 금액 끝자리 555 = 인증창 생성 실패
    await prisma.creatorProfile.update({ where: { id: fx.creatorId }, data: { donationAmount: 3555n } });
    await seedRegisteredDonor(fx.donorPhone);

    const res = await inbound(moPayload({ to: fx.moNumber }));
    expect(res.status).toBe('PAYMENT_FAILED');
    expect(await prisma.paymentPinSession.count()).toBe(0);
    expect(await prisma.paymentTransaction.count()).toBe(0);

    const donation = await prisma.donation.findFirstOrThrow({ where: { id: res.donationId } });
    expect(donation.status).toBe('PAYMENT_FAILED');
    expect(readMockOutbox(3).some((m) => m.text.includes('완료되지 않았습니다'))).toBe(true);
  });

  it('[10] 같은 후원으로 두 번 요청해도 PIN 링크는 한 장만 발급된다', async () => {
    await seedRegisteredDonor(fx.donorPhone);
    const res = await inbound(moPayload({ to: fx.moNumber }));

    const again = await startPinAuthorization(res.donationId!);
    expect(again.ok).toBe(true);
    expect(await prisma.paymentPinSession.count()).toBe(1);
    expect(await prisma.mtOutboundMessage.count({ where: { templateCode: 'PIN_REQUEST' } })).toBe(1);
  });

  it('[11] 한도를 넘긴 후원은 PIN 링크 자체가 발급되지 않는다', async () => {
    const donor = await seedRegisteredDonor(fx.donorPhone);
    await prisma.donationLimitPolicy.updateMany({ where: { scope: 'GLOBAL' }, data: { donorDailyLimit: 1000n } });

    const res = await inbound(moPayload({ to: fx.moNumber }));
    expect(res.status).toBe('LIMIT_BLOCKED');
    expect(await prisma.paymentPinSession.count()).toBe(0);
    expect(await prisma.paymentTransaction.count()).toBe(0);
    expect(await prisma.riskDetection.count({ where: { donorId: donor.id } })).toBe(1);
  });
});
