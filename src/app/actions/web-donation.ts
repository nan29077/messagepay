'use server';

import { prisma } from '@/server/db';
import { kv } from '@/server/redis';
import { newId } from '@/lib/id';
import { hmac, maskPhone, normalizePhone, phoneHash, safeEqual } from '@/lib/crypto';
import { getMtAdapter } from '@/server/adapters/mt';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { issueSecureLink } from '@/server/services/secure-link';
import { createWebDonation } from '@/server/services/web-donation';

/**
 * 후원샵 PC 웹 후원 서버 액션.
 *
 * 1) 전화번호로 인증번호 발송 → 2) 인증 성공 시 서버 KV 에 인증 세션 저장
 * 3) 등록 후원자(내통장결제 가입자)면 텍스트+금액 후원을 즉시 결제 실행
 *    미가입자면 가입 보안 링크를 발급해 팝업으로 안내한다.
 *
 * 보안: 인증 코드는 HMAC 으로만 저장, 시도 5회 제한, 발송 3회/10분 제한,
 *       클라이언트에는 불투명 티켓만 전달, 세션 30분.
 */

const CODE_TTL_SEC = 300;
const MAX_ATTEMPTS = 5;
const SEND_WINDOW_SEC = 600;
const SEND_MAX = 3;
const SESSION_SEC = 1800;

const codeKey = (t: string) => `webdon:code:${t}`;
const sessionKey = (t: string) => `webdon:session:${t}`;
const sendPhoneKey = (ph: string) => `webdon:send:${ph}`;

function digest(code: string) {
  return hmac(code, env.crypto.sessionSecret);
}

function randomCode() {
  return String(100000 + Math.floor(Math.random() * 900000));
}

export interface WebDonateState {
  ok: boolean;
  step: 'phone' | 'code' | 'ready' | 'register' | 'done';
  message?: string;
  phoneMasked?: string;
  ticket?: string;
  /** 인증 완료 후 발급되는 세션 티켓 (후원 제출에 사용) */
  session?: string;
  /** 미가입자의 내통장결제 가입 링크 (팝업으로 연다) */
  registerUrl?: string;
  /** 비운영 mock 환경에서만 노출되는 인증번호 */
  devCode?: string;
  /** 후원 완료 정보 */
  transactionNo?: string;
}

// ---------------------------------------------------------------- 1) 인증번호 발송

export async function requestWebDonateCode(_prev: WebDonateState, formData: FormData): Promise<WebDonateState> {
  const phone = normalizePhone(String(formData.get('phone') ?? ''));
  if (!/^01[0-9]{8,9}$/.test(phone)) {
    return { ok: false, step: 'phone', message: '휴대전화 번호 형식을 확인해 주세요. (예: 010-1234-5678)' };
  }

  const ph = phoneHash(phone);
  const sent = await kv.incr(sendPhoneKey(ph), SEND_WINDOW_SEC);
  if (sent > SEND_MAX) {
    return { ok: false, step: 'phone', message: '인증번호 발송이 너무 잦습니다. 10분 후 다시 시도해 주세요.' };
  }

  const code = randomCode();
  const masked = maskPhone(phone);
  const ticket = newId();

  const adapter = getMtAdapter();
  const res = await adapter.send({
    to: phone,
    text: `[도네이도] 후원샵 결제 인증번호는 ${code} 입니다. 5분 안에 입력해 주세요.`,
    templateCode: 'WEBDON_VERIFY',
  });
  if (!res.ok) {
    return { ok: false, step: 'phone', message: '인증번호 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.' };
  }

  await kv.set(
    codeKey(ticket),
    JSON.stringify({ ph, pm: masked, pn: phone, ch: digest(code), at: MAX_ATTEMPTS }),
    CODE_TTL_SEC,
  );
  logger.info('후원샵 웹 후원 인증번호 발송', { phone: masked });

  return {
    ok: true,
    step: 'code',
    phoneMasked: masked,
    ticket,
    message: `${masked} 번호로 인증번호를 발송했습니다.`,
    devCode: env.appEnv !== 'prod' && adapter.info().provider === 'mock' ? code : undefined,
  };
}

// ---------------------------------------------------------------- 2) 인증 확인

export async function verifyWebDonateCode(_prev: WebDonateState, formData: FormData): Promise<WebDonateState> {
  const ticket = String(formData.get('ticket') ?? '');
  const code = String(formData.get('code') ?? '').replace(/\s/g, '');
  const creatorId = String(formData.get('creatorId') ?? '');
  if (!ticket) return { ok: false, step: 'phone', message: '인증 정보가 만료되었습니다. 처음부터 다시 시도해 주세요.' };
  if (!/^\d{6}$/.test(code)) return { ok: false, step: 'code', ticket, message: '인증번호 6자리를 입력해 주세요.' };

  const raw = await kv.get(codeKey(ticket));
  if (!raw) return { ok: false, step: 'phone', message: '인증 유효시간이 지났습니다. 인증번호를 다시 요청해 주세요.' };

  let rec: { ph: string; pm: string; pn: string; ch: string; at: number };
  try {
    rec = JSON.parse(raw);
  } catch {
    await kv.del(codeKey(ticket));
    return { ok: false, step: 'phone', message: '인증 정보가 손상되었습니다. 다시 시도해 주세요.' };
  }

  if (!safeEqual(digest(code), rec.ch)) {
    const remain = rec.at - 1;
    if (remain <= 0) {
      await kv.del(codeKey(ticket));
      return { ok: false, step: 'phone', message: '인증번호를 5회 잘못 입력했습니다. 처음부터 다시 시도해 주세요.' };
    }
    await kv.set(codeKey(ticket), JSON.stringify({ ...rec, at: remain }), CODE_TTL_SEC);
    return { ok: false, step: 'code', ticket, phoneMasked: rec.pm, message: `인증번호가 일치하지 않습니다. (남은 시도 ${remain}회)` };
  }

  await kv.del(codeKey(ticket));
  const session = newId();
  await kv.set(sessionKey(session), rec.ph, SESSION_SEC);

  // 등록(내통장결제 가입 + 활성 결제수단) 여부 확인
  const donor = await prisma.donorProfile.findUnique({
    where: { phoneHash: rec.ph },
    select: { id: true },
  });
  const token = donor
    ? await prisma.paymentMethodToken.findFirst({ where: { donorId: donor.id, status: 'ACTIVE' }, select: { id: true } })
    : null;

  if (donor && token) {
    return { ok: true, step: 'ready', session, phoneMasked: rec.pm, message: '인증이 완료되었습니다. 금액과 메시지를 확인한 뒤 후원해 주세요.' };
  }

  // 미가입: 내통장결제 가입 보안 링크 발급 (팝업으로 안내)
  const link = await issueSecureLink({
    purpose: 'REGISTER_ACCOUNT',
    phoneHash: rec.ph,
    creatorId: creatorId || undefined,
    payload: { channel: 'WEB' },
  });
  return {
    ok: true,
    step: 'register',
    session,
    phoneMasked: rec.pm,
    registerUrl: link.url,
    message: '내통장결제 가입이 필요합니다. 가입 창에서 계좌 등록을 완료한 뒤 이 창에서 후원을 이어가 주세요.',
  };
}

// ---------------------------------------------------------------- 3) 후원 제출 (즉시 결제)

export async function submitWebDonation(_prev: WebDonateState, formData: FormData): Promise<WebDonateState> {
  const session = String(formData.get('session') ?? '');
  const creatorId = String(formData.get('creatorId') ?? '');
  const requestId = String(formData.get('requestId') ?? '');
  const message = String(formData.get('message') ?? '').trim();
  const amountRaw = String(formData.get('amount') ?? '').replace(/[^\d]/g, '');

  if (!session) return { ok: false, step: 'phone', message: '인증이 만료되었습니다. 전화번호 인증을 다시 진행해 주세요.' };
  const ph = await kv.get(sessionKey(session));
  if (!ph) return { ok: false, step: 'phone', message: '인증이 만료되었습니다. 전화번호 인증을 다시 진행해 주세요.' };

  if (!creatorId || !requestId) return { ok: false, step: 'ready', session, message: '요청 정보가 올바르지 않습니다.' };
  if (!message) return { ok: false, step: 'ready', session, message: '후원 메시지를 입력해 주세요.' };
  if (message.length > 200) return { ok: false, step: 'ready', session, message: '후원 메시지는 200자 이내로 입력해 주세요.' };
  if (!/^\d{3,7}$/.test(amountRaw)) return { ok: false, step: 'ready', session, message: '후원 금액을 확인해 주세요.' };

  const result = await createWebDonation({
    phoneHash: ph,
    creatorId,
    amount: BigInt(amountRaw),
    message,
    requestId,
  });

  if (!result.ok) {
    // 결제수단 미등록으로 실패한 경우 가입 단계로 되돌린다
    if (result.message.includes('가입')) {
      const link = await issueSecureLink({
        purpose: 'REGISTER_ACCOUNT',
        phoneHash: ph,
        creatorId,
        payload: { channel: 'WEB' },
      });
      return { ok: false, step: 'register', session, registerUrl: link.url, message: result.message };
    }
    return { ok: false, step: 'ready', session, message: result.message };
  }

  return { ok: true, step: 'done', session, transactionNo: result.transactionNo, message: result.message };
}

// ---------------------------------------------------------------- 가입 완료 후 재확인

export async function checkWebDonateRegistered(_prev: WebDonateState, formData: FormData): Promise<WebDonateState> {
  const session = String(formData.get('session') ?? '');
  if (!session) return { ok: false, step: 'phone', message: '인증이 만료되었습니다. 처음부터 다시 시도해 주세요.' };
  const ph = await kv.get(sessionKey(session));
  if (!ph) return { ok: false, step: 'phone', message: '인증이 만료되었습니다. 처음부터 다시 시도해 주세요.' };

  const donor = await prisma.donorProfile.findUnique({ where: { phoneHash: ph }, select: { id: true } });
  const token = donor
    ? await prisma.paymentMethodToken.findFirst({ where: { donorId: donor.id, status: 'ACTIVE' }, select: { id: true } })
    : null;

  if (donor && token) {
    return { ok: true, step: 'ready', session, message: '가입이 확인되었습니다. 이제 후원할 수 있습니다.' };
  }
  return { ok: false, step: 'register', session, message: '아직 가입이 완료되지 않았습니다. 가입 창에서 계좌 등록을 마친 뒤 다시 확인해 주세요.' };
}
