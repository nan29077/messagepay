import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 후원샵 PC 웹 후원 — PIN 인증 흐름.
 *
 *   금액·메시지 → 번호 입력(인증번호 없음) → PIN 링크 문자 → PIN 입력 → 콜백 → 결제
 *
 * 이 파일이 지키는 것
 *  1) 번호 입력만으로는 절대 출금되지 않는다.
 *  2) 결제수단이 등록된 번호에만 PIN 링크가 나간다(미등록은 가입 안내).
 *  3) 상태 조회는 HttpOnly 쿠키에 담긴 후원만 볼 수 있다.
 *  4) 유효시간이 지나면 자동 취소되고, 그 뒤 콜백으로도 결제되지 않는다.
 *
 * 서버 액션은 next/headers 의 쿠키 저장소를 사용하므로 테스트용 메모리 저장소로 대체한다.
 */

const cookieJar = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  }),
}));

import { prisma } from '@/server/db';
import { maskPhone, phoneHash } from '@/lib/crypto';
import {
  startWebPinDonation,
  checkWebPinDonationStatus,
  type WebPinState,
} from '@/app/actions/web-donation-pin';
import { resolveWebDonationChannel } from '@/server/services/web-donation';
import { completePinAuthorization, expireStalePinSessions } from '@/server/services/pin-authorization';
import { resetDb, seedBasics, seedRegisteredDonor, type Fixture } from './helpers';

let fx: Fixture;

const initial: WebPinState = { ok: false, step: 'phone' };

function fd(entries: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(entries)) form.set(k, v);
  return form;
}

/**
 * PIN 링크 발송은 번호당 10분에 3회로 제한된다(인메모리 KV 는 resetDb 로 비워지지 않는다).
 * 테스트마다 다른 번호를 써서 앞선 테스트의 카운터에 걸리지 않게 한다.
 */
let phoneSeq = 0;
function nextPhone() {
  phoneSeq += 1;
  return `0105555${String(phoneSeq).padStart(4, '0')}`;
}

let reqSeq = 0;
function donateForm(phone: string, overrides: Record<string, string> = {}) {
  reqSeq += 1;
  return fd({
    phone,
    creatorId: fx.creatorId,
    requestId: `web-pin-${Date.now()}-${reqSeq}`,
    message: '웹에서 보내는 응원 메시지',
    amount: '3000',
    ...overrides,
  });
}

describe('후원샵 웹 후원 — PIN 인증 흐름', () => {
  beforeEach(async () => {
    await resetDb();
    cookieJar.clear();
    delete process.env.ALLOW_LEGACY_WEB_INSTANT_PAY;
    fx = await seedBasics();
  });

  it('플래그가 없으면 PIN 경로를 탄다', () => {
    expect(resolveWebDonationChannel()).toBe('PIN');
    expect(resolveWebDonationChannel(true)).toBe('LEGACY_INSTANT');
    expect(resolveWebDonationChannel(false)).toBe('PIN');
  });

  it('[1] 번호를 입력하면 PIN 링크 문자만 나가고 출금은 일어나지 않는다', async () => {
    const phone = nextPhone();
    await seedRegisteredDonor(phone);

    const state = await startWebPinDonation(initial, donateForm(phone));

    expect(state.ok).toBe(true);
    expect(state.step).toBe('waiting');
    expect(state.phoneMasked).toBe(maskPhone(phone));
    expect(state.expiresAt).toBeTruthy();
    expect(state.mock).toBe(true);

    // 인증번호(OTP) 문자는 더 이상 나가지 않는다.
    expect(await prisma.mtOutboundMessage.count({ where: { templateCode: 'PAYMENT_VERIFY' } })).toBe(0);

    // PIN 링크 문자 1통만 나간다.
    const mt = await prisma.mtOutboundMessage.findFirstOrThrow({ where: { templateCode: 'PIN_REQUEST' } });
    expect(mt.status).toBe('SENT');
    expect(mt.phoneHash).toBe(phoneHash(phone));
    expect(mt.bodyMasked).toContain('[보안링크]');

    // 후원은 PIN 대기 상태이고 결제 트랜잭션은 없다.
    const donation = await prisma.donation.findFirstOrThrow();
    expect(donation.channel).toBe('WEB');
    expect(donation.status).toBe('PENDING_PIN');
    expect(await prisma.paymentTransaction.count()).toBe(0);
    expect(await prisma.settlementLedger.count()).toBe(0);

    const session = await prisma.paymentPinSession.findFirstOrThrow();
    expect(session.donationId).toBe(donation.id);
    expect(session.status).toBe('PENDING');
  });

  it('[2] PIN 콜백을 받으면 결제가 완료되고 폴링이 완료를 알려준다', async () => {
    const phone = nextPhone();
    await seedRegisteredDonor(phone);
    await startWebPinDonation(initial, donateForm(phone));

    const waiting = await checkWebPinDonationStatus();
    expect(waiting.step).toBe('waiting');

    const session = await prisma.paymentPinSession.findFirstOrThrow();
    const done = await completePinAuthorization({ sessionId: session.sessionId });
    expect(done.code).toBe('OK');

    const polled = await checkWebPinDonationStatus();
    expect(polled.ok).toBe(true);
    expect(polled.step).toBe('done');
    expect(polled.transactionNo).toBeTruthy();

    expect(await prisma.paymentTransaction.count({ where: { status: 'APPROVED' } })).toBe(1);
    const donation = await prisma.donation.findFirstOrThrow();
    expect(donation.paidAt).not.toBeNull();
    expect(await prisma.settlementLedger.count({ where: { donationId: donation.id } })).toBe(3);
  });

  it('[3] 유효시간이 지나면 자동 취소되고 폴링이 만료를 알려준다', async () => {
    const phone = nextPhone();
    await seedRegisteredDonor(phone);
    await startWebPinDonation(initial, donateForm(phone));

    await prisma.paymentPinSession.updateMany({
      where: { status: 'PENDING' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    // 배치가 돌기 전이라도 폴링이 만료를 반영한다.
    const polled = await checkWebPinDonationStatus();
    expect(polled.ok).toBe(false);
    expect(polled.step).toBe('failed');
    expect(polled.message).toContain('시간이 지나');

    const donation = await prisma.donation.findFirstOrThrow();
    expect(donation.status).toBe('PAYMENT_FAILED');
    expect(await prisma.paymentTransaction.count()).toBe(0);

    // 이미 정리됐으므로 배치가 다시 세지 않는다.
    expect(await expireStalePinSessions()).toBe(0);

    // 만료 뒤 콜백이 와도 결제되지 않는다.
    const session = await prisma.paymentPinSession.findFirstOrThrow();
    const late = await completePinAuthorization({ sessionId: session.sessionId });
    expect(late.code).toBe('EXPIRED');
    expect(await prisma.paymentTransaction.count()).toBe(0);
  });

  it('[4] 결제수단이 없는 번호에는 PIN 링크 대신 등록 안내가 나간다', async () => {
    const unregistered = nextPhone();
    const state = await startWebPinDonation(initial, donateForm(unregistered));

    expect(state.ok).toBe(true);
    expect(state.step).toBe('register');
    expect(state.registerUrl).toContain('/r/');

    // 후원도 인증 세션도 만들지 않는다.
    expect(await prisma.donation.count()).toBe(0);
    expect(await prisma.paymentPinSession.count()).toBe(0);
    expect(await prisma.paymentTransaction.count()).toBe(0);

    const mt = await prisma.mtOutboundMessage.findFirstOrThrow({ where: { templateCode: 'REGISTER_GUIDE' } });
    expect(mt.status).toBe('SENT');
    // 가입 화면이 찾을 수 있도록 후원자 프로필만 만들어 둔다.
    expect(await prisma.donorProfile.count({ where: { phoneHash: phoneHash(unregistered) } })).toBe(1);
  });

  it('[5] 쿠키가 없으면 남의 후원 상태를 볼 수 없다', async () => {
    const phone = nextPhone();
    await seedRegisteredDonor(phone);
    await startWebPinDonation(initial, donateForm(phone));
    expect(await prisma.donation.count()).toBe(1);

    // 다른 브라우저(쿠키 없음)에서의 조회
    cookieJar.clear();
    const polled = await checkWebPinDonationStatus();
    expect(polled.ok).toBe(false);
    expect(polled.step).toBe('phone');
    expect(polled.transactionNo).toBeUndefined();
  });

  it('[6] 같은 멱등키로 두 번 눌러도 후원과 PIN 링크는 하나만 만들어진다', async () => {
    const phone = nextPhone();
    await seedRegisteredDonor(phone);
    const form = donateForm(phone);
    const again = donateForm(phone);
    // 같은 requestId 로 재제출된 상황을 재현한다.
    again.set('requestId', String(form.get('requestId')));

    const first = await startWebPinDonation(initial, form);
    const second = await startWebPinDonation(initial, again);

    expect(first.step).toBe('waiting');
    expect(second.ok).toBe(false);
    expect(await prisma.donation.count()).toBe(1);
    expect(await prisma.paymentPinSession.count()).toBe(1);
    expect(await prisma.mtOutboundMessage.count({ where: { templateCode: 'PIN_REQUEST' } })).toBe(1);
    expect(await prisma.paymentTransaction.count()).toBe(0);
  });

  it('[7] 발송 횟수 제한을 넘기면 더 이상 문자를 보내지 않는다', async () => {
    const phone = nextPhone();
    await seedRegisteredDonor(phone);

    for (let i = 0; i < 3; i += 1) {
      const res = await startWebPinDonation(initial, donateForm(phone));
      expect(res.step).toBe('waiting');
    }
    const blocked = await startWebPinDonation(initial, donateForm(phone));

    expect(blocked.ok).toBe(false);
    expect(blocked.step).toBe('phone');
    expect(blocked.message).toContain('너무 잦습니다');
    // 4번째 요청은 후원도 문자도 만들지 않는다.
    expect(await prisma.donation.count()).toBe(3);
    expect(await prisma.mtOutboundMessage.count({ where: { templateCode: 'PIN_REQUEST' } })).toBe(3);
  });

  it('[8] 되돌림 플래그를 켜면 구 즉시결제 경로가 그대로 동작한다', async () => {
    const phone = nextPhone();
    const donor = await seedRegisteredDonor(phone);
    process.env.ALLOW_LEGACY_WEB_INSTANT_PAY = 'true';
    try {
      expect(resolveWebDonationChannel()).toBe('LEGACY_INSTANT');

      const { createWebDonation } = await import('@/server/services/web-donation');
      const res = await createWebDonation({
        phoneHash: phoneHash(phone),
        creatorId: fx.creatorId,
        amount: 3000n,
        message: '구 경로 즉시 결제',
        requestId: `legacy-${Date.now()}`,
      });

      expect(res.ok).toBe(true);
      // 즉시 결제이므로 PIN 인증 세션 없이 바로 승인된다.
      expect(await prisma.paymentPinSession.count()).toBe(0);
      expect(await prisma.paymentTransaction.count({ where: { status: 'APPROVED' } })).toBe(1);
      const donation = await prisma.donation.findFirstOrThrow({ where: { donorId: donor.id } });
      expect(donation.paidAt).not.toBeNull();
    } finally {
      delete process.env.ALLOW_LEGACY_WEB_INSTANT_PAY;
    }
  });

  it('[9] 금액·메시지가 올바르지 않으면 아무것도 만들지 않는다', async () => {
    const phone = nextPhone();
    await seedRegisteredDonor(phone);

    const noMessage = await startWebPinDonation(initial, donateForm(phone, { message: '   ' }));
    expect(noMessage.ok).toBe(false);
    const badPhone = await startWebPinDonation(initial, donateForm('02-123-4567'));
    expect(badPhone.ok).toBe(false);
    const badAmount = await startWebPinDonation(initial, donateForm(phone, { amount: '0' }));
    expect(badAmount.ok).toBe(false);

    expect(await prisma.donation.count()).toBe(0);
    expect(await prisma.mtOutboundMessage.count()).toBe(0);
    expect(await prisma.paymentTransaction.count()).toBe(0);
  });
});
