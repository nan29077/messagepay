import { NextResponse } from 'next/server';
import { prisma } from '@/server/db';
import { newId } from '@/lib/id';
import { env, isLocal } from '@/lib/env';
import { safeEqual } from '@/lib/crypto';
import { logger, scrub } from '@/lib/logger';
import { completePinAuthorization } from '@/server/services/pin-authorization';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PIN 인증 완료 콜백 (결제사 → 토네이도).
 *
 * 후원자가 결제사 화면에서 PIN 을 입력하면 결제사가 이 엔드포인트를 호출하고,
 * 그때 비로소 승인(출금)이 실행된다. 브라우저 리턴이 오지 않아도
 * 이 서버 통지만으로 결제가 마무리되어야 한다.
 *
 * 처리 순서
 *  1) 본문 크기 제한 → 원문 보존(WebhookLog)
 *  2) 서명 검증 (현재는 X-Pin-Secret 공유 비밀. TODO: 실연동 시 결제사 서명으로 교체)
 *  3) 인증 세션 확인 + 멱등 처리 → executePayment
 *  4) 재전송 폭주를 막기 위해 처리 결과는 200 으로 응답한다.
 *     (서명 실패만 401 로 명확히 거절한다)
 *
 * Mock 단계에서는 모의 PIN 화면(/mock/pg/pin)과 수동 테스트가 이 엔드포인트를 사용한다.
 */

/** 콜백 본문은 아무리 커도 수 KB 다. 인증 전 단계이므로 과도한 본문은 기록 없이 거절한다. */
const MAX_BODY_BYTES = 16 * 1024;

interface PinCallbackBody {
  sessionId?: unknown;
  donationId?: unknown;
  resultCode?: unknown;
  resultMessage?: unknown;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * 콜백 인증.
 *
 * TODO(계약 후): 결제사 규격의 서명(해시) 검증으로 교체한다.
 *                지금은 공유 비밀(X-Pin-Secret) 대조만 수행하는 mock 단계다.
 *
 * PAYMENT_PIN_CALLBACK_SECRET 이 비어 있으면 로컬에서만 통과시킨다.
 * 운영/스테이징에서 비밀이 없으면 어떤 콜백도 받지 않는다(fail-closed).
 */
function verifyCallback(headerSecret: string | null): { ok: boolean; reason?: string } {
  const expected = env.payment.pinCallbackSecret;
  if (!expected) {
    if (isLocal) return { ok: true };
    return { ok: false, reason: 'PAYMENT_PIN_CALLBACK_SECRET 미설정' };
  }
  if (!headerSecret) return { ok: false, reason: 'X-Pin-Secret 헤더 없음' };
  return safeEqual(expected, headerSecret) ? { ok: true } : { ok: false, reason: '공유 비밀 불일치' };
}

export async function POST(req: Request) {
  const started = Date.now();
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, message: '요청 본문이 너무 큽니다.' }, { status: 413 });
  }
  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, message: '요청 본문이 너무 큽니다.' }, { status: 413 });
  }

  const headerMap: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    headerMap[k.toLowerCase()] = v;
  });
  const ip = (headerMap['x-forwarded-for'] ?? '').split(',')[0]?.trim() || undefined;

  const verified = verifyCallback(headerMap['x-pin-secret'] ?? null);

  let parsed: PinCallbackBody = {};
  try {
    parsed = JSON.parse(raw) as PinCallbackBody;
  } catch {
    parsed = {};
  }

  const logRow = await prisma.webhookLog.create({
    data: {
      id: newId(),
      source: 'PIN_CALLBACK',
      endpoint: '/api/webhooks/pin-callback',
      headersMask: scrub(headerMap) as object,
      bodyMasked: scrub(parsed) as object,
      signatureOk: verified.ok,
      ip: ip ?? null,
    },
  });

  const finish = async (statusCode: number, note: string, body: Record<string, unknown>) => {
    await prisma.webhookLog.update({
      where: { id: logRow.id },
      data: { statusCode, responseNote: note.slice(0, 500), latencyMs: Date.now() - started },
    });
    return NextResponse.json(body, { status: statusCode });
  };

  if (!verified.ok) {
    logger.warn('PIN 콜백 서명 검증 실패', { reason: verified.reason, ip });
    return finish(401, verified.reason ?? '서명 검증 실패', { ok: false, message: '인증되지 않은 요청입니다.' });
  }

  const sessionId = str(parsed.sessionId);
  const donationId = str(parsed.donationId);
  if (!sessionId && !donationId) {
    return finish(400, 'sessionId/donationId 없음', {
      ok: false,
      message: 'sessionId 또는 donationId 가 필요합니다.',
    });
  }

  try {
    const result = await completePinAuthorization({
      sessionId,
      donationId,
      resultCode: str(parsed.resultCode),
      resultMessage: str(parsed.resultMessage),
    });
    return finish(200, result.code, {
      ok: result.ok,
      code: result.code,
      status: result.status ?? null,
      message: result.message,
    });
  } catch (e) {
    logger.error('PIN 콜백 처리 오류', { message: (e as Error).message });
    // 결제사에는 200 으로 응답하되 내부적으로 오류를 남긴다(재전송 폭주 방지).
    return finish(200, `ERROR: ${(e as Error).message}`, {
      ok: false,
      message: '수신은 되었으나 처리에 실패했습니다.',
    });
  }
}
