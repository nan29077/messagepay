import { prisma } from '@/server/db';
import { newId } from '@/lib/id';
import { getPaymentAdapter } from '@/server/adapters/payment';
import { calculateFees, postRefundSettlement } from './settlement';
import { rollbackCounters } from './limits';
import { sendMtForDonor } from './donation-flow';
import * as tpl from './mt-templates';

/**
 * 환불 처리.
 * - 정산 원장은 수정하지 않고 반대 분개를 추가한다.
 * - 이미 정산 지급된 건의 환불은 마이너스 잔액으로 남아 다음 정산에서 차감된다.
 */

export async function requestRefund(input: {
  donationId: string;
  reason: string;
  requestedBy?: string;
}) {
  const donation = await prisma.donation.findUnique({ where: { id: input.donationId } });
  if (!donation) throw new Error('후원 거래를 찾을 수 없습니다.');
  if (!['PAYMENT_SUCCESS', 'BROADCAST_PENDING', 'BROADCASTED', 'PARTIAL_DELIVERY_FAILED', 'SETTLEMENT_PENDING', 'SETTLED'].includes(donation.status)) {
    throw new Error('결제가 완료된 거래만 환불할 수 있습니다.');
  }
  const existing = await prisma.refund.findFirst({
    where: { donationId: input.donationId, status: { in: ['REQUESTED', 'APPROVED', 'DONE'] } },
  });
  if (existing) throw new Error('이미 환불이 요청된 거래입니다.');

  const refund = await prisma.refund.create({
    data: {
      id: newId(),
      donationId: donation.id,
      amount: donation.amount,
      reason: input.reason,
      requestedBy: input.requestedBy ?? null,
    },
  });
  await prisma.donation.update({ where: { id: donation.id }, data: { status: 'REFUND_REQUESTED' } });
  return refund;
}

export async function approveRefund(refundId: string, adminUserId?: string) {
  const refund = await prisma.refund.findUnique({
    where: { id: refundId },
    include: { donation: { include: { creator: true, transactions: true } } },
  });
  if (!refund) throw new Error('환불 요청을 찾을 수 없습니다.');
  if (refund.status === 'DONE') return refund;

  // 이중 승인 방어.
  // (1) 요청 상태가 아닌 건(거절·실패)을 되살려 다시 취소·반대분개하지 않는다.
  // (2) 동시에 두 관리자가 승인해도 조건부 UPDATE 로 한쪽만 선점하게 한다.
  //     append-only 원장에 환불 분개가 두 번 쌓이면 되돌릴 수 없으므로 PG 취소 호출 전에 APPROVED 로 선점한다.
  if (refund.status !== 'REQUESTED') {
    throw new Error('요청 상태의 환불만 승인할 수 있습니다. 목록을 새로고침해 현재 상태를 확인해 주세요.');
  }
  const claimed = await prisma.refund.updateMany({
    where: { id: refundId, status: 'REQUESTED' },
    data: { status: 'APPROVED' },
  });
  if (claimed.count === 0) {
    throw new Error('이미 다른 처리가 진행 중인 환불입니다. 잠시 후 상태를 다시 확인해 주세요.');
  }

  const txn = refund.donation.transactions.find((t) => t.status === 'APPROVED');
  if (!txn) throw new Error('승인된 결제 거래가 없습니다.');

  const adapter = getPaymentAdapter();
  const res = await adapter.cancel({
    orderNo: txn.orderNo,
    providerTid: txn.providerTid ?? '',
    amount: refund.amount,
    reason: refund.reason ?? '고객 요청',
  });

  if (!res.ok) {
    // 선점(APPROVED)했다가 PG 취소에 실패한 건은 FAILED 로 확정한다.
    // 관리자 화면에서 재시도(신규 환불 요청)로 이어갈 수 있도록 사유를 남긴다.
    await prisma.refund.update({
      where: { id: refundId },
      data: { status: 'FAILED', resultCode: res.code ?? null, resultMessage: res.message ?? null },
    });
    throw new Error(res.message ?? '환불 처리에 실패했습니다.');
  }

  const fees = await calculateFees(refund.donation.creatorId, refund.amount);
  const now = new Date();

  await prisma.$transaction([
    prisma.refund.update({
      where: { id: refundId },
      data: { status: 'DONE', approvedBy: adminUserId ?? null, processedAt: now, providerTid: txn.providerTid },
    }),
    prisma.paymentTransaction.update({ where: { id: txn.id }, data: { status: 'CANCELED', canceledAt: now } }),
    prisma.donation.update({
      where: { id: refund.donationId },
      data: { status: 'REFUNDED', refundedAt: now },
    }),
    prisma.donationStatusLog.create({
      data: { id: newId(), donationId: refund.donationId, toStatus: 'REFUNDED', actor: adminUserId ?? 'admin', reason: refund.reason },
    }),
  ]);

  await postRefundSettlement({
    creatorId: refund.donation.creatorId,
    donationId: refund.donationId,
    refundId: refund.id,
    amount: refund.amount,
    fees,
    occurredAt: now,
  });

  if (refund.donation.donorId && refund.donation.paidAt) {
    await rollbackCounters(refund.donation.donorId, refund.donation.creatorId, refund.amount, refund.donation.paidAt);
    await prisma.donorCreatorLink.updateMany({
      where: { donorId: refund.donation.donorId, creatorId: refund.donation.creatorId },
      data: { totalAmount: { decrement: refund.amount }, totalCount: { decrement: 1 } },
    });
    await sendMtForDonor(
      refund.donation.donorId,
      tpl.tplRefundDone(refund.donation.creator.displayName, refund.amount),
      refund.donationId,
      refund.donation.creatorId,
    );
  }

  return prisma.refund.findUnique({ where: { id: refundId } });
}

export async function rejectRefund(refundId: string, adminUserId?: string, memo?: string) {
  const refund = await prisma.refund.findUnique({ where: { id: refundId } });
  if (!refund) throw new Error('환불 요청을 찾을 수 없습니다.');
  await prisma.refund.update({
    where: { id: refundId },
    data: { status: 'REJECTED', approvedBy: adminUserId ?? null, resultMessage: memo ?? null, processedAt: new Date() },
  });
  await prisma.donation.update({
    where: { id: refund.donationId },
    data: { status: 'SETTLEMENT_PENDING', statusReason: '환불 거절' },
  });
  return refund;
}
