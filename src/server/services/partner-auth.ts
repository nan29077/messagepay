import crypto from 'node:crypto';
import { prisma } from '@/server/db';
import { decrypt, encrypt, generateToken, safeEqual, tokenHash } from '@/lib/crypto';
import { newId } from '@/lib/id';
import { kv } from '@/server/redis';
import { logger } from '@/lib/logger';

/**
 * 가맹점 연동 API 인증.
 *
 * 메시지페이는 가맹점에 API 연동을 **요구하지 않는다.** 가맹점은 메시지페이 관리자
 * 화면에서 충전 내역을 확인하고 포인트 지급 처리를 할 수 있다.
 * 이 API 는 자기 사이트에서 포인트를 자동 적립하려는 가맹점을 위한 선택 기능이다.
 *
 * 인증 규칙
 *  - 모든 요청: Authorization: Bearer <API 키>
 *  - 상태를 바꾸는 요청(POST): HMAC-SHA256 서명 필수 (재전송 공격 차단)
 *  - 조회 요청(GET): 서명이 있으면 검증하고, 없으면 Bearer 만으로 통과
 *  - 키는 해시로만 저장한다. 원문은 발급 시 1회만 노출하고 다시 볼 수 없다.
 */

/** 키 앞부분 길이(식별·조회용). 원문 전체를 저장하지 않으므로 이 값만 화면에 남는다. */
const PREFIX_LEN = 12;
/** 서명 타임스탬프 허용 오차 (초). 시계 오차를 감안해 5분. */
export const SIGNATURE_SKEW_SEC = 300;
/** 분당 요청 허용치 (키 단위) */
const RATE_LIMIT_PER_MIN = 300;

export const PARTNER_HEADERS = {
  timestamp: 'x-messagepay-timestamp',
  signature: 'x-messagepay-signature',
} as const;

export interface PartnerAuthOk {
  ok: true;
  merchantId: string;
  keyId: string;
}

export interface PartnerAuthFail {
  ok: false;
  status: number;
  code: string;
  message: string;
}

export type PartnerAuthResult = PartnerAuthOk | PartnerAuthFail;

function fail(status: number, code: string, message: string): PartnerAuthFail {
  return { ok: false, status, code, message };
}

/** 서명 원문: `{timestamp}.{METHOD}.{path}.{rawBody}` */
export function signaturePayload(timestamp: string, method: string, path: string, rawBody: string): string {
  return `${timestamp}.${method.toUpperCase()}.${path}.${rawBody}`;
}

export function signPartnerRequest(
  secret: string,
  timestamp: string,
  method: string,
  path: string,
  rawBody: string,
): string {
  return crypto
    .createHmac('sha256', secret)
    .update(signaturePayload(timestamp, method, path, rawBody))
    .digest('hex');
}

/**
 * 새 API 키 발급.
 * 반환한 apiKey / signingSecret 은 저장하지 않는다. 호출자가 화면에 1회 노출한 뒤 버려야 한다.
 */
export async function issueMerchantApiKey(merchantId: string, name: string) {
  const apiKey = `mp_live_${generateToken(24)}`;
  const signingSecret = generateToken(32);

  const row = await prisma.merchantApiKey.create({
    data: {
      id: newId(),
      merchantId,
      name: name.slice(0, 40) || '연동 키',
      prefix: apiKey.slice(0, PREFIX_LEN),
      keyHash: tokenHash(apiKey),
      signingEnc: encrypt(signingSecret),
    },
    select: { id: true, prefix: true, name: true, createdAt: true },
  });

  return { ...row, apiKey, signingSecret };
}

/**
 * 요청 인증.
 *
 * @param rawBody POST 본문 원문. 서명 검증에 쓰므로 JSON.parse 전의 문자열이어야 한다.
 */
export async function authenticatePartner(
  req: Request,
  rawBody: string,
  now: Date = new Date(),
): Promise<PartnerAuthResult> {
  const header = req.headers.get('authorization') ?? '';
  const matched = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!matched) return fail(401, 'UNAUTHORIZED', 'Authorization: Bearer <API 키> 헤더가 필요합니다.');

  const presented = matched[1]!.trim();
  const key = await prisma.merchantApiKey.findUnique({
    where: { keyHash: tokenHash(presented) },
    select: {
      id: true, merchantId: true, revokedAt: true, signingEnc: true,
      merchant: { select: { status: true } },
    },
  });
  if (!key) return fail(401, 'INVALID_KEY', 'API 키가 올바르지 않습니다.');
  if (key.revokedAt) return fail(401, 'REVOKED_KEY', '폐기된 API 키입니다.');
  if (key.merchant.status !== 'APPROVED') {
    return fail(403, 'MERCHANT_NOT_ACTIVE', '이용할 수 없는 가맹점 상태입니다.');
  }

  // 분당 요청 제한 (키 단위)
  const minuteBucket = Math.floor(now.getTime() / 60_000);
  const used = await kv.incr(`partner:rate:${key.id}:${minuteBucket}`, 90).catch(() => 0);
  if (used > RATE_LIMIT_PER_MIN) {
    return fail(429, 'RATE_LIMITED', `분당 요청 한도(${RATE_LIMIT_PER_MIN}회)를 초과했습니다.`);
  }

  const method = req.method.toUpperCase();
  const path = new URL(req.url).pathname;
  const ts = req.headers.get(PARTNER_HEADERS.timestamp);
  const sig = req.headers.get(PARTNER_HEADERS.signature);
  const writeMethod = method !== 'GET' && method !== 'HEAD';

  if (writeMethod && (!ts || !sig)) {
    return fail(401, 'SIGNATURE_REQUIRED', '상태를 바꾸는 요청에는 서명 헤더가 필요합니다.');
  }

  if (ts || sig) {
    if (!ts || !sig) return fail(401, 'SIGNATURE_INVALID', '타임스탬프와 서명을 함께 보내야 합니다.');
    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum)) return fail(401, 'SIGNATURE_INVALID', '타임스탬프 형식이 올바르지 않습니다.');
    // 초 단위 epoch 로 받는다. 밀리초로 보내면 오차 검사에서 걸린다.
    if (Math.abs(Math.floor(now.getTime() / 1000) - tsNum) > SIGNATURE_SKEW_SEC) {
      return fail(401, 'SIGNATURE_EXPIRED', `타임스탬프 오차가 ${SIGNATURE_SKEW_SEC}초를 넘습니다.`);
    }

    const expected = signPartnerRequest(decrypt(key.signingEnc), ts, method, path, rawBody);
    if (!safeEqual(expected, sig.trim().toLowerCase())) {
      return fail(401, 'SIGNATURE_INVALID', '서명이 올바르지 않습니다.');
    }

    // 같은 서명 재사용(재전송) 차단. 쓰기 요청에만 적용한다.
    if (writeMethod) {
      const fresh = await kv.setnx(`partner:nonce:${key.id}:${sig}`, '1', SIGNATURE_SKEW_SEC * 2).catch(() => true);
      if (!fresh) return fail(409, 'REPLAYED', '이미 처리된 요청입니다(서명 재사용).');
    }
  }

  // 마지막 사용 시각은 실패해도 요청을 막지 않는다.
  prisma.merchantApiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: now } })
    .catch((e) => logger.warn('API 키 사용 시각 기록 실패', { message: (e as Error).message }));

  return { ok: true, merchantId: key.merchantId, keyId: key.id };
}
