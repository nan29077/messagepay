import { prisma } from '@/server/db';
import { decrypt } from '@/lib/crypto';
import { authenticatePartner } from '@/server/services/partner-auth';
import { PAID_STATUSES } from '@/components/studio/shared';
import { authError, jsonError, jsonOk, logPartnerCall } from '../_shared';
import type { Prisma } from '@/generated/prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 한 번에 내려주는 최대 건수. 커서로 이어 받는다. */
const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

/**
 * GET /api/partner/v1/charges
 *
 * 결제가 완료된 충전 건을 오래된 순으로 내려준다.
 * 가맹점은 이 목록을 받아 자기 사이트의 회원에게 포인트를 적립하고,
 * 처리한 건을 /charges/ack 로 알려주면 다음 조회에서 빠진다.
 *
 * query
 *  - status : pending(기본, 아직 지급 처리하지 않은 건) | all
 *  - since  : ISO8601. 이 시각 이후 결제 건만
 *  - limit  : 1~500 (기본 100)
 *  - cursor : 직전 응답의 nextCursor
 *
 * 이용자 식별은 **휴대폰 번호**로 한다. 이용자가 가맹점 번호로 MO 를 보낸 건이므로
 * 가맹점은 이미 그 번호를 알고 있는 상태다. 다만 개인정보이므로 저장·이용 범위를
 * 연동 규격서의 안내에 맞춰 최소화해야 한다.
 */
export async function GET(req: Request) {
  const auth = await authenticatePartner(req, '');
  if (!auth.ok) {
    await logPartnerCall({
      req, merchantId: auth.merchantId ?? null, keyId: auth.keyId,
      status: auth.status, errorCode: auth.code, message: auth.message,
    });
    return authError(auth);
  }

  const url = new URL(req.url);
  const status = (url.searchParams.get('status') ?? 'pending').toLowerCase();
  if (status !== 'pending' && status !== 'all') {
    return logPartnerCall({
      req, merchantId: auth.merchantId, keyId: auth.keyId,
      status: 400, errorCode: 'INVALID_STATUS',
    }).then(() => jsonError(400, 'INVALID_STATUS', 'status 는 pending 또는 all 이어야 합니다.'));
  }

  const limitRaw = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
  if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > MAX_LIMIT) {
    return logPartnerCall({
      req, merchantId: auth.merchantId, keyId: auth.keyId,
      status: 400, errorCode: 'INVALID_LIMIT',
    }).then(() => jsonError(400, 'INVALID_LIMIT', `limit 은 1~${MAX_LIMIT} 사이 정수여야 합니다.`));
  }

  const sinceRaw = url.searchParams.get('since');
  let since: Date | undefined;
  if (sinceRaw) {
    const parsed = new Date(sinceRaw);
    if (Number.isNaN(parsed.getTime())) {
      return logPartnerCall({
        req, merchantId: auth.merchantId, keyId: auth.keyId,
        status: 400, errorCode: 'INVALID_SINCE',
      }).then(() => jsonError(400, 'INVALID_SINCE', 'since 는 ISO8601 형식이어야 합니다.'));
    }
    since = parsed;
  }

  const cursor = url.searchParams.get('cursor') ?? undefined;
  if (cursor) {
    // 남의 가맹점 결제 ID 를 커서로 넣어 목록을 훔쳐보지 못하게 소유를 확인한다.
    const owned = await prisma.charge.findFirst({
      where: { id: cursor, merchantId: auth.merchantId },
      select: { id: true },
    });
    if (!owned) return logPartnerCall({
   req, merchantId: auth.merchantId, keyId: auth.keyId,
   status: 400, errorCode: 'INVALID_CURSOR',
 }).then(() => jsonError(400, 'INVALID_CURSOR', 'cursor 가 올바르지 않습니다.'));
  }

  const where: Prisma.ChargeWhereInput = {
    merchantId: auth.merchantId,
    status: { in: PAID_STATUSES },
    paidAt: since ? { gte: since } : { not: null },
    // 환불된 건은 포인트 지급 대상이 아니다.
    refundedAt: null,
    ...(status === 'pending' ? { pointStatus: { in: ['PENDING', 'FAILED'] } } : {}),
  };

  const rows = await prisma.charge.findMany({
    where,
    // 결제 시각이 같은 건이 있어도 순서가 흔들리지 않게 id 를 보조 정렬로 둔다.
    orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
    take: limitRaw,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      transactionNo: true,
      amount: true,
      shippingFee: true,
      quantity: true,
      optionText: true,
      message: true,
      channel: true,
      status: true,
      pointStatus: true,
      paidAt: true,
      isTest: true,
      payer: { select: { phoneEnc: true, phoneMasked: true, phoneHash: true } },
      product: {
        select: { id: true, kind: true, digitalType: true, name: true, sku: true, giveAmount: true, giveUnit: true, validDays: true },
      },
      shipment: {
        select: {
          receiverEnc: true, phoneEnc: true, zipCode: true, addressEnc: true,
          memo: true, remote: true, status: true, carrier: true, trackingNo: true,
        },
      },
    },
  });

  return jsonOk({
    items: rows.map((r) => ({
      transactionNo: r.transactionNo,
      // 금액과 포인트는 1:1 이다.
      amount: Number(r.amount),
      points: Number(r.amount),
      currency: 'KRW',
      // 이용자 식별 기준. 가맹점 회원의 휴대폰 번호와 매칭한다.
      payerPhone: r.payer ? decrypt(r.payer.phoneEnc) : null,
      payerPhoneMasked: r.payer?.phoneMasked ?? null,
      // 번호를 저장하고 싶지 않은 가맹점을 위한 고정 해시(같은 번호 = 같은 값).
      payerRef: r.payer?.phoneHash ?? null,
      message: r.message,
      channel: r.channel,
      chargeStatus: r.status,
      pointStatus: r.pointStatus,
      paidAt: r.paidAt ? r.paidAt.toISOString() : null,
      test: r.isTest,

      // ── 상품 ──────────────────────────────────────────────────
      // 상품 없이 금액만 직접 입력한 결제는 product 가 null 이다.
      product: r.product
        ? {
            id: r.product.id,
            kind: r.product.kind,
            digitalType: r.product.digitalType,
            name: r.product.name,
            sku: r.product.sku,
            // 지급할 수량. 비어 있으면 결제 금액과 1:1(포인트 기준)로 본다.
            giveAmount: r.product.giveAmount != null ? Number(r.product.giveAmount) : null,
            giveUnit: r.product.giveUnit,
            validDays: r.product.validDays,
          }
        : null,
      quantity: r.quantity,
      optionText: r.optionText,
      // 결제 금액에 포함된 배송비. 포인트 적립 금액을 계산할 때 빼야 한다.
      shippingFee: Number(r.shippingFee),
      goodsAmount: Number(r.amount - r.shippingFee),

      // ── 배송 (실물 주문만) ────────────────────────────────────
      // 배송지는 개인정보다. 배송·CS 목적으로만 쓰고 그 외 이용·제공은 금지된다.
      shipping: r.shipment
        ? {
            receiver: decrypt(r.shipment.receiverEnc),
            phone: decrypt(r.shipment.phoneEnc),
            zipCode: r.shipment.zipCode,
            address: decrypt(r.shipment.addressEnc),
            memo: r.shipment.memo,
            remote: r.shipment.remote,
            status: r.shipment.status,
            carrier: r.shipment.carrier,
            trackingNo: r.shipment.trackingNo,
          }
        : null,
    })),
    // 받은 건수가 limit 과 같으면 더 있을 수 있다. 다음 호출에 그대로 넣는다.
    nextCursor: rows.length === limitRaw ? (rows[rows.length - 1]?.id ?? null) : null,
  });
}
