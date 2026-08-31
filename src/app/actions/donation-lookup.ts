'use server';

import { prisma } from '@/server/db';
import { kv } from '@/server/redis';
import { newId } from '@/lib/id';
import { generateNumericCode, hmac, maskPhone, normalizePhone, phoneHash, safeEqual } from '@/lib/crypto';
import { getMtAdapter } from '@/server/adapters/mt';
import { applyMtTemplateOverride, tplLookupVerify } from '@/server/services/mt-templates';
import { env, isLocal } from '@/lib/env';
import { logger } from '@/lib/logger';
import { formatWon } from '@/lib/money';
import { formatKst } from '@/lib/datetime';
import { donationStatusLabel } from '@/lib/labels';

/**
 * 로그인 없이 휴대폰 번호로 결제 내역 조회 (결제내역 바텀시트).
 *
 * 보안 설계
 *  - 결제 내역은 개인정보다. 번호만 입력하면 누구나 타인의 내역을 볼 수 있으므로
 *    반드시 그 번호로 문자 인증번호를 받아 본인 확인을 마친 뒤에만 결과를 돌려준다.
 *    (회원가입/로그인은 필요 없지만, 번호 소유 확인은 필요하다)
 *  - 인증 상태는 서버 KV 에만 두고, 검증값은 서버 시크릿 HMAC 으로 보관한다.
 *  - 발송·조회 모두 속도 제한을 건다.
 *  - 결과에는 마스킹된 번호만 사용하고 거래번호·결제수단 정보는 노출하지 않는다.
 */

const TTL_SEC = 300;
const MAX_ATTEMPTS = 5;
const SEND_WINDOW_SEC = 600;
const SEND_MAX = 3;
/** 인증 후 조회 결과를 유지하는 시간 */
const SESSION_SEC = 600;

export interface LookupState {
  ok: boolean;
  step: 'phone' | 'code' | 'result';
  message?: string;
  phoneMasked?: string;
  /** 인증 진행용 티켓. 번호 원문 대신 이 값만 클라이언트로 오간다 */
  ticket?: string;
  /** 비운영 환경에서만 노출하는 mock 인증번호 */
  devCode?: string;
  result?: LookupResult;
}

export interface LookupResult {
  phoneMasked: string;
  totalCount: number;
  totalAmount: string;
  registered: boolean;
  items: Array<{
    id: string;
    creatorName: string;
    creatorCode: string;
    amount: string;
    message: string;
    statusText: string;
    statusTone: 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
    receivedAt: string;
  }>;
}

const codeKey = (ticket: string) => `lookup:code:${ticket}`;
const sessionKey = (ticket: string) => `lookup:session:${ticket}`;
const sendPhoneKey = (ph: string) => `lookup:send:${ph}`;

function digest(code: string) {
  return hmac(code, env.crypto.sessionSecret);
}

function randomCode() {
  return generateNumericCode(6);
}

// ---------------------------------------------------------------- 1단계: 인증번호 발송

export async function requestLookupCode(_prev: LookupState, formData: FormData): Promise<LookupState> {
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
  const template = await applyMtTemplateOverride(tplLookupVerify(code));
  const res = await adapter.send({ to: phone, text: template.text, templateCode: template.code });
  if (!res.ok) {
    return { ok: false, step: 'phone', message: '인증번호 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.' };
  }

  await kv.set(
    codeKey(ticket),
    JSON.stringify({ ph, pm: masked, ch: digest(code), at: MAX_ATTEMPTS }),
    TTL_SEC,
  );
  logger.info('결제내역 조회 인증번호 발송', { phone: masked });

  return {
    ok: true,
    step: 'code',
    phoneMasked: masked,
    ticket,
    message: `${masked} 번호로 인증번호를 발송했습니다.`,
    devCode: isLocal && adapter.info().provider === 'mock' ? code : undefined,
  };
}

// ---------------------------------------------------------------- 2단계: 인증 후 조회

export async function verifyAndLookup(_prev: LookupState, formData: FormData): Promise<LookupState> {
  const ticket = String(formData.get('ticket') ?? '');
  const code = String(formData.get('code') ?? '').replace(/\s/g, '');
  if (!ticket) return { ok: false, step: 'phone', message: '인증 정보가 만료되었습니다. 처음부터 다시 시도해 주세요.' };
  if (!/^\d{6}$/.test(code)) return { ok: false, step: 'code', message: '인증번호 6자리를 입력해 주세요.' };

  const raw = await kv.get(codeKey(ticket));
  if (!raw) return { ok: false, step: 'phone', message: '인증 유효시간이 지났습니다. 인증번호를 다시 요청해 주세요.' };

  let rec: { ph: string; pm: string; ch: string; at: number };
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
    await kv.set(codeKey(ticket), JSON.stringify({ ...rec, at: remain }), TTL_SEC);
    return {
      ok: false,
      step: 'code',
      phoneMasked: rec.pm,
      ticket,
      message: `인증번호가 일치하지 않습니다. (남은 시도 ${remain}회)`,
    };
  }

  await kv.del(codeKey(ticket));
  await kv.set(sessionKey(ticket), rec.ph, SESSION_SEC);

  const result = await loadResult(rec.ph, rec.pm);
  return { ok: true, step: 'result', phoneMasked: rec.pm, result };
}

// ---------------------------------------------------------------- 조회 본체

async function loadResult(ph: string, phoneMasked: string): Promise<LookupResult> {
  const donor = await prisma.donorProfile.findUnique({
    where: { phoneHash: ph },
    select: { id: true, registeredAt: true },
  });

  if (!donor) {
    return { phoneMasked, totalCount: 0, totalAmount: formatWon(0n), registered: false, items: [] };
  }

  const [donations, paid] = await Promise.all([
    prisma.donation.findMany({
      where: { donorId: donor.id },
      orderBy: { receivedAt: 'desc' },
      take: 30,
      select: {
        id: true,
        amount: true,
        message: true,
        status: true,
        receivedAt: true,
        creator: { select: { displayName: true, code: true } },
      },
    }),
    prisma.donation.aggregate({
      where: {
        donorId: donor.id,
        status: {
          in: ['PAYMENT_SUCCESS', 'BROADCAST_PENDING', 'BROADCASTED', 'PARTIAL_DELIVERY_FAILED', 'SETTLEMENT_PENDING', 'SETTLED'],
        },
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  return {
    phoneMasked,
    totalCount: paid._count._all,
    totalAmount: formatWon(paid._sum.amount ?? 0n),
    registered: Boolean(donor.registeredAt),
    items: donations.map((d) => {
      const label = donationStatusLabel[d.status];
      return {
        id: d.id,
        creatorName: d.creator.displayName,
        creatorCode: d.creator.code,
        amount: formatWon(d.amount),
        message: d.message || '(내용 없음)',
        statusText: label.text,
        statusTone: label.tone,
        receivedAt: formatKst(d.receivedAt, false),
      };
    }),
  };
}
