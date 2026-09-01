import { prisma } from '@/server/db';
import { authenticatePartner } from '@/server/services/partner-auth';
import { PAID_STATUSES } from '@/components/studio/shared';
import { authError, jsonError, jsonOk } from '../../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = ['PREPARING', 'SHIPPED', 'DELIVERED', 'CANCELED'] as const;
type Status = (typeof STATUSES)[number];

interface ShipBody {
  transactionNo?: unknown;
  status?: unknown;
  carrier?: unknown;
  trackingNo?: unknown;
  memo?: unknown;
}

/**
 * POST /api/partner/v1/charges/shipment
 *
 * 실물 주문의 배송 상태와 송장번호를 등록한다.
 * 가맹점이 자기 물류 시스템에서 출고 처리한 결과를 메시지페이에 반영하는 용도다.
 *
 * body
 *  { "transactionNo": "MP...", "status": "SHIPPED", "carrier": "CJ대한통운", "trackingNo": "123456789012" }
 *
 * - 서명 헤더 필수(쓰기 요청).
 * - SHIPPED 로 바꾸려면 carrier 와 trackingNo 가 있어야 한다.
 *   송장 없이 발송 처리하면 이용자가 조회할 수 없고 분쟁 시 발송 사실을 증명하지 못한다.
 * - 같은 값을 다시 보내도 결과가 같다(멱등).
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const auth = await authenticatePartner(req, rawBody);
  if (!auth.ok) return authError(auth);

  let body: ShipBody;
  try {
    body = JSON.parse(rawBody || '{}') as ShipBody;
  } catch {
    return jsonError(400, 'INVALID_JSON', '본문이 올바른 JSON 이 아닙니다.');
  }

  const transactionNo = String(body.transactionNo ?? '').trim();
  if (!transactionNo) return jsonError(400, 'INVALID_ITEMS', 'transactionNo 가 필요합니다.');

  const status = String(body.status ?? '').toUpperCase();
  if (!STATUSES.includes(status as Status)) {
    return jsonError(400, 'INVALID_STATUS', `status 는 ${STATUSES.join(' / ')} 중 하나여야 합니다.`);
  }

  const carrier = body.carrier == null ? null : String(body.carrier).slice(0, 30).trim() || null;
  const trackingNo =
    body.trackingNo == null ? null : String(body.trackingNo).replace(/[^0-9A-Za-z-]/g, '').slice(0, 40) || null;
  const memo = body.memo == null ? null : String(body.memo).slice(0, 100) || null;

  if (status === 'SHIPPED' && (!carrier || !trackingNo)) {
    return jsonError(400, 'TRACKING_REQUIRED', '발송(SHIPPED) 처리에는 carrier 와 trackingNo 가 필요합니다.');
  }

  // 본인 가맹점의 결제 완료 실물 주문인지 확인한다.
  const charge = await prisma.charge.findFirst({
    where: { transactionNo, merchantId: auth.merchantId, status: { in: PAID_STATUSES } },
    select: { id: true, shipment: { select: { shippedAt: true } } },
  });
  if (!charge) return jsonError(404, 'NOT_FOUND', '해당 거래번호의 결제 완료 주문을 찾을 수 없습니다.');
  if (!charge.shipment) return jsonError(400, 'NOT_PHYSICAL', '배송 정보가 없는 주문입니다(실물 상품이 아닙니다).');

  const now = new Date();
  await prisma.chargeShipment.update({
    where: { chargeId: charge.id },
    data: {
      status: status as Status,
      carrier,
      trackingNo,
      memo,
      // 발송 시각은 처음 발송으로 바꾼 때만 기록한다(수정할 때마다 갱신하면 배송 지연을 못 본다).
      shippedAt:
        status === 'SHIPPED'
          ? charge.shipment.shippedAt ?? now
          : status === 'PREPARING'
            ? null
            : charge.shipment.shippedAt,
      deliveredAt: status === 'DELIVERED' ? now : null,
    },
  });

  return jsonOk({ transactionNo, status, carrier, trackingNo });
}
