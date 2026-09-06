import { prisma } from '@/server/db';
import { authenticatePartner } from '@/server/services/partner-auth';
import { WEBHOOK_EVENTS, emitMerchantEvent, type WebhookEvent } from '@/server/services/webhooks';
import { authError, jsonError, jsonOk, logPartnerCall, sandboxOnly } from '../../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/partner/v1/sandbox/webhooks/fire
 *
 * 원하는 이벤트를 골라 등록된 수신 URL 로 보낸다.
 * 수신 처리와 서명 검증을 실제 거래 없이 시험하기 위한 것이다.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const auth = await authenticatePartner(req, rawBody);
  if (!auth.ok) {
    await logPartnerCall({
      req, merchantId: auth.merchantId ?? null, keyId: auth.keyId,
      status: auth.status, errorCode: auth.code, message: auth.message,
    });
    return authError(auth);
  }

  const denied = sandboxOnly(auth.mode);
  if (denied) {
    await logPartnerCall({ req, merchantId: auth.merchantId, keyId: auth.keyId, status: 403, errorCode: 'TEST_KEY_REQUIRED' });
    return denied;
  }

  let body: { type?: string; data?: Record<string, unknown> };
  try {
    body = JSON.parse(rawBody || '{}');
  } catch {
    return logPartnerCall({
      req, merchantId: auth.merchantId, keyId: auth.keyId, status: 400, errorCode: 'INVALID_JSON',
    }).then(() => jsonError(400, 'INVALID_JSON', '본문이 올바른 JSON 이 아닙니다.'));
  }

  const type = String(body.type ?? '');
  if (!WEBHOOK_EVENTS.includes(type as WebhookEvent)) {
    await logPartnerCall({ req, merchantId: auth.merchantId, keyId: auth.keyId, status: 400, errorCode: 'INVALID_EVENT' });
    return jsonError(400, 'INVALID_EVENT', `type 은 다음 중 하나여야 합니다: ${WEBHOOK_EVENTS.join(', ')}`);
  }

  const before = await prisma.webhookDelivery.count({ where: { merchantId: auth.merchantId } });
  await emitMerchantEvent(auth.merchantId, type as WebhookEvent, {
    sandbox: true,
    ...(body.data ?? {}),
  });
  const after = await prisma.webhookDelivery.count({ where: { merchantId: auth.merchantId } });

  await logPartnerCall({ req, merchantId: auth.merchantId, keyId: auth.keyId, status: 200, message: `fire ${type}` });
  return jsonOk({ fired: type, deliveries: after - before });
}
