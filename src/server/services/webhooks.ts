import crypto from 'node:crypto';
import { prisma } from '@/server/db';
import { newId } from '@/lib/id';
import { decrypt, encrypt, generateToken } from '@/lib/crypto';
import { logger } from '@/lib/logger';

/**
 * 가맹점 웹훅.
 *
 * 가맹점이 주기적으로 가져가는(pull) 대신, 일이 생긴 순간 밀어 준다.
 *
 * 설계에서 지키는 두 가지
 *  1. **발행이 본 흐름을 막지 않는다.** 결제 성공 처리가 가맹점 서버 사정 때문에
 *     실패하면 안 된다. 그래서 `emitMerchantEvent` 는 적재만 하고 전송은 따로 돈다.
 *     이 함수는 어떤 경우에도 예외를 밖으로 던지지 않는다.
 *  2. **중복 도착을 전제로 한다.** 실패하면 재전송하므로 같은 이벤트가 두 번 갈 수 있다.
 *     받는 쪽이 eventId 로 걸러야 하며, 문서에도 그렇게 적어 두었다.
 */

/**
 * 이벤트 목록과 실제 발생 여부.
 *
 * `live: false` 는 아직 어디서도 발행하지 않는 이벤트다. 구독은 걸어 둘 수 있지만
 * 실제로 오지는 않는다. 문서·화면이 이 값을 그대로 읽어 "준비 중"으로 표시하므로,
 * 발행 지점을 붙일 때 여기 값도 함께 바꿔야 한다.
 */
export const WEBHOOK_EVENT_META = [
  { type: 'charge.succeeded', live: true, label: '결제가 완료되었습니다' },
  { type: 'charge.failed', live: true, label: '결제가 실패했습니다' },
  { type: 'mo.received', live: true, label: '이용자가 문자를 보냈습니다' },
  { type: 'shipment.updated', live: true, label: '배송 상태가 바뀌었습니다' },
  { type: 'charge.refunded', live: false, label: '결제가 환불되었습니다' },
  { type: 'mt.delivered', live: false, label: '보낸 문자가 도달했습니다' },
  { type: 'mt.failed', live: false, label: '보낸 문자가 실패했습니다' },
  { type: 'settlement.paid', live: false, label: '정산금이 지급되었습니다' },
  { type: 'payer.linked', live: false, label: '이용자 연결이 만들어졌습니다' },
  { type: 'product.stock_low', live: false, label: '재고가 기준 아래로 떨어졌습니다' },
] as const;

/** 가맹점이 구독할 수 있는 이벤트. 문서와 검증이 같은 목록을 쓴다. */
export const WEBHOOK_EVENTS = WEBHOOK_EVENT_META.map((e) => e.type);

export type WebhookEvent = (typeof WEBHOOK_EVENT_META)[number]['type'];

/** 재시도 간격(초). 앞은 촘촘하고 뒤로 갈수록 벌린다. 다 쓰면 DEAD 가 된다. */
const RETRY_DELAYS_SEC = [30, 120, 600, 3600, 21600];

/** 전송 타임아웃. 받는 쪽이 느리면 재시도가 쌓이므로 짧게 끊는다. */
const TIMEOUT_MS = 10_000;

export const WEBHOOK_HEADERS = {
  id: 'x-messagepay-event-id',
  type: 'x-messagepay-event-type',
  timestamp: 'x-messagepay-timestamp',
  signature: 'x-messagepay-signature',
} as const;

/** 서명 원문: `{timestamp}.{eventId}.{본문 원문}` — 가맹점 API 서명과 같은 형태로 맞췄다. */
export function webhookSignaturePayload(timestamp: string, eventId: string, rawBody: string): string {
  return `${timestamp}.${eventId}.${rawBody}`;
}

export function signWebhook(secret: string, timestamp: string, eventId: string, rawBody: string): string {
  return crypto.createHmac('sha256', secret).update(webhookSignaturePayload(timestamp, eventId, rawBody)).digest('hex');
}

/** 수신 URL 형식 검사. 평문 http 와 사설망 주소는 받지 않는다. */
export function validateWebhookUrl(raw: string): { ok: true; url: string } | { ok: false; message: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, message: 'URL 형식이 올바르지 않습니다.' };
  }
  if (parsed.protocol !== 'https:') {
    // 평문으로 보내면 결제 정보가 중간에서 그대로 읽힌다.
    return { ok: false, message: '수신 URL 은 https 여야 합니다.' };
  }
  const host = parsed.hostname.toLowerCase();
  const isPrivate =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.local') ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (isPrivate) {
    // 사설망 주소를 받아 두면 우리 서버가 내부망을 긁는 통로가 된다(SSRF).
    return { ok: false, message: '내부망 주소는 수신 URL 로 등록할 수 없습니다.' };
  }
  return { ok: true, url: parsed.toString() };
}

/** 수신 URL 등록. 서명 비밀키는 이때 한 번만 돌려준다. */
export async function registerWebhook(input: {
  merchantId: string;
  url: string;
  events: string[];
  description?: string | null;
}) {
  const checked = validateWebhookUrl(input.url);
  if (!checked.ok) return { ok: false as const, message: checked.message };

  const unknown = input.events.filter((e) => !WEBHOOK_EVENTS.includes(e as WebhookEvent));
  if (unknown.length > 0) {
    return { ok: false as const, message: `알 수 없는 이벤트입니다: ${unknown.join(', ')}` };
  }

  const secret = generateToken(32);
  const row = await prisma.merchantWebhook.create({
    data: {
      id: newId(),
      merchantId: input.merchantId,
      url: checked.url,
      secretEnc: encrypt(secret),
      events: input.events.join(','),
      description: input.description?.slice(0, 100) ?? null,
    },
  });
  return { ok: true as const, webhook: row, secret };
}

/**
 * 이벤트 발행.
 *
 * 구독 중인 수신 URL 수만큼 전송 건을 적재하고, 즉시 한 번 보내 본다.
 * 실패하면 재시도 일정에 올라간다. **어떤 경우에도 예외를 밖으로 던지지 않는다.**
 */
export async function emitMerchantEvent(
  merchantId: string,
  type: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const hooks = await prisma.merchantWebhook.findMany({ where: { merchantId, active: true } });
    const targets = hooks.filter((h) => !h.events || h.events.split(',').filter(Boolean).includes(type));
    if (targets.length === 0) return;

    const eventId = newId();
    const payload = JSON.stringify({
      eventId,
      type,
      occurredAt: new Date().toISOString(),
      merchantId,
      data,
    });

    const created = await Promise.all(
      targets.map((hook) =>
        prisma.webhookDelivery.create({
          data: {
            id: newId(),
            merchantId,
            webhookId: hook.id,
            eventId,
            eventType: type,
            payload,
            nextAttemptAt: new Date(),
          },
        }),
      ),
    );

    // 즉시 한 번 시도한다. 여기서 실패해도 크론이 다시 집어간다.
    for (const delivery of created) {
      void deliverOnce(delivery.id).catch(() => undefined);
    }
  } catch (e) {
    // 웹훅 때문에 결제·정산 흐름이 멈추면 안 된다. 기록만 남기고 넘어간다.
    logger.warn('웹훅 발행 실패', { merchantId, type, message: (e as Error).message });
  }
}

/** 전송 1회 시도. 성공하면 SENT, 실패하면 다음 재시도 시각을 잡는다. */
export async function deliverOnce(deliveryId: string): Promise<boolean> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { webhook: true },
  });
  if (!delivery || delivery.status === 'SENT') return false;
  if (!delivery.webhook.active) return false;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signWebhook(decrypt(delivery.webhook.secretEnc), timestamp, delivery.eventId, delivery.payload);

  let responseStatus: number | null = null;
  let error: string | null = null;
  try {
    const res = await fetch(delivery.webhook.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [WEBHOOK_HEADERS.id]: delivery.eventId,
        [WEBHOOK_HEADERS.type]: delivery.eventType,
        [WEBHOOK_HEADERS.timestamp]: timestamp,
        [WEBHOOK_HEADERS.signature]: signature,
      },
      body: delivery.payload,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    responseStatus = res.status;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (e) {
    error = (e as Error).message.slice(0, 200);
  }

  const ok = responseStatus !== null && responseStatus >= 200 && responseStatus < 300;
  const attempts = delivery.attempts + 1;
  const delay = RETRY_DELAYS_SEC[attempts - 1];

  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      attempts,
      responseStatus,
      error,
      status: ok ? 'SENT' : delay === undefined ? 'DEAD' : 'PENDING',
      deliveredAt: ok ? new Date() : null,
      nextAttemptAt: ok || delay === undefined ? null : new Date(Date.now() + delay * 1000),
    },
  });
  await prisma.merchantWebhook
    .update({ where: { id: delivery.webhookId }, data: { lastStatus: responseStatus, lastAt: new Date() } })
    .catch(() => undefined);

  return ok;
}

/** 재시도 시각이 된 전송 건을 처리한다. 크론이 부른다. */
export async function drainWebhookQueue(limit = 50): Promise<{ tried: number; sent: number }> {
  const rows = await prisma.webhookDelivery.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
    select: { id: true },
  });
  let sent = 0;
  for (const row of rows) {
    if (await deliverOnce(row.id).catch(() => false)) sent += 1;
  }
  return { tried: rows.length, sent };
}
