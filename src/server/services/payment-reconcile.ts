import { prisma } from '@/server/db';
import { newId } from '@/lib/id';
import { logger } from '@/lib/logger';
import { calculateFees, postDonationSettlement } from './settlement';
import { rollbackCounters } from './limits';
import { sendMtForDonor, setStatus } from './donation-flow';
import * as tpl from './mt-templates';

/**
 * 결과 미확인(UNKNOWN / TIMEOUT) 결제의 수동 대사.
 *
 * 왜 사람이 판단하는가
 *  결제사 응답이 끊긴 건은 **실제로 출금이 되었는지 시스템이 알 수 없다.**
 *  자동으로 실패 처리하면 출금된 돈이 정산되지 않고, 자동으로 성공 처리하면
 *  받지도 않은 돈을 크리에이터에게 지급한다. 그래서 관리자가 PG 관리자 화면에서
 *  대사한 뒤 이 함수로 결론만 반영한다.
 *
 * 절대 원칙
 *  1) UNKNOWN / TIMEOUT 상태의 결제 거래에만 적용한다. 이미 확정된 건은 건드리지 않는다.
 *  2) 승인 확정은 executePayment 의 승인 경로와 **같은 장부 처리**를 한다.
 *     (수수료 계산 + 정산 원장 분개 + 후원자-크리에이터 누적)
 *  3) 방송 송출은 다시 하지 않는다. 대사는 보통 몇 시간 뒤에 이루어지므로
 *     그때 오버레이/유튜브로 알림이 나가면 시청자에게 잘못된 시점의 후원이 보인다.
 *  4) 취소 확정은 예약해 둔 한도 집계를 되돌린다(출금이 없었으므로 한도를 쓰지 않는다).
 */

export type ReconcileDecision = 'APPROVE' | 'CANCEL';

export interface ReconcileResult {
  ok: boolean;
  message: string;
  transactionNo?: string;
}

/** 대사 가능한 결제 거래 상태 */
const RECONCILABLE = ['UNKNOWN', 'TIMEOUT'] as const;

export async function reconcileUnknownPayment(
  transactionId: string,
  decision: ReconcileDecision,
  memo: string,
): Promise<ReconcileResult> {
  const txn = await prisma.paymentTransaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true,
      status: true,
      orderNo: true,
      providerTid: true,
      amount: true,
      requestedAt: true,
      donationId: true,
    },
  });
  if (!txn) throw new Error('결제 거래를 찾을 수 없습니다.');
  if (!RECONCILABLE.includes(txn.status as (typeof RECONCILABLE)[number])) {
    throw new Error('결과 확인이 필요한(UNKNOWN·TIMEOUT) 결제만 수동으로 확정할 수 있습니다.');
  }

  const donation = await prisma.donation.findUnique({
    where: { id: txn.donationId },
    select: {
      id: true,
      status: true,
      transactionNo: true,
      amount: true,
      message: true,
      displayName: true,
      creatorId: true,
      donorId: true,
      creator: { select: { displayName: true, thanksMtMessage: true } },
    },
  });
  if (!donation) throw new Error('후원 거래를 찾을 수 없습니다.');

  return decision === 'APPROVE'
    ? confirmApproved(txn, donation, memo)
    : confirmCanceled(txn, donation, memo);
}

type TxnRow = {
  id: string;
  orderNo: string;
  providerTid: string | null;
  amount: bigint;
  requestedAt: Date;
  donationId: string;
};

type DonationRow = {
  id: string;
  status: string;
  transactionNo: string;
  amount: bigint;
  message: string;
  displayName: string;
  creatorId: string;
  donorId: string | null;
  creator: { displayName: string; thanksMtMessage: string | null };
};

/**
 * 실제로 출금된 것으로 확인된 경우.
 * 승인 기록과 정산 원장 분개는 반드시 같은 트랜잭션이어야 한다(executePayment 와 동일).
 */
async function confirmApproved(txn: TxnRow, donation: DonationRow, memo: string): Promise<ReconcileResult> {
  if (donation.status !== 'PENDING_PAYMENT') {
    throw new Error(`후원 상태가 결제 진행중(PENDING_PAYMENT)이 아닙니다. 현재 상태: ${donation.status}`);
  }

  const approvedAt = new Date();
  const fees = await calculateFees(donation.creatorId, donation.amount);

  await prisma.$transaction(async (tx) => {
    await tx.paymentTransaction.update({
      where: { id: txn.id },
      data: {
        status: 'APPROVED',
        providerTid: txn.providerTid ?? txn.orderNo,
        approvedAt,
        resultCode: 'ADMIN_CONFIRMED',
        resultMessage: `관리자 수동 확정: ${memo}`.slice(0, 500),
      },
    });
    await tx.donation.update({
      where: { id: donation.id },
      data: {
        status: 'SETTLEMENT_PENDING',
        statusReason: '관리자 수동 확정 후 정산 대기',
        paidAt: approvedAt,
        pgFee: fees.pgFee,
        platformFee: fees.platformFee,
        feeVat: fees.vat,
        netAmount: fees.net,
        // 대사 시점에는 방송이 끝났을 수 있어 송출은 하지 않는다.
        overlayStatus: 'SKIPPED',
        youtubeStatus: 'SKIPPED',
      },
    });
    await tx.donationStatusLog.createMany({
      data: [
        {
          id: newId(),
          donationId: donation.id,
          fromStatus: 'PENDING_PAYMENT',
          toStatus: 'PAYMENT_SUCCESS',
          reason: `관리자 수동 확정: ${memo}`,
          actor: 'admin',
        },
        {
          id: newId(),
          donationId: donation.id,
          fromStatus: 'PAYMENT_SUCCESS',
          toStatus: 'SETTLEMENT_PENDING',
          reason: '정산 대기',
          actor: 'admin',
        },
      ],
    });
    if (donation.donorId) {
      await tx.donorCreatorLink.upsert({
        where: { donorId_creatorId: { donorId: donation.donorId, creatorId: donation.creatorId } },
        create: {
          id: newId(),
          donorId: donation.donorId,
          creatorId: donation.creatorId,
          consentedAt: approvedAt,
          totalAmount: donation.amount,
          totalCount: 1,
          lastDonatedAt: approvedAt,
        },
        update: {
          totalAmount: { increment: donation.amount },
          totalCount: { increment: 1 },
          lastDonatedAt: approvedAt,
        },
      });
    }
    await postDonationSettlement(
      {
        creatorId: donation.creatorId,
        donationId: donation.id,
        amount: donation.amount,
        fees,
        occurredAt: approvedAt,
      },
      tx,
    );
  });

  // 한도 집계는 결제 판정 시점에 이미 예약(반영)되어 있으므로 다시 더하지 않는다.
  if (donation.donorId) {
    const link = await prisma.donorCreatorLink.findUnique({
      where: { donorId_creatorId: { donorId: donation.donorId, creatorId: donation.creatorId } },
      select: { totalAmount: true },
    });
    await sendMtForDonor(
      donation.donorId,
      tpl.tplDonationSuccess({
        donorName: donation.displayName,
        creatorName: donation.creator.displayName,
        amount: donation.amount,
        message: donation.message,
        cumulative: link?.totalAmount ?? donation.amount,
        custom: donation.creator.thanksMtMessage,
      }),
      donation.id,
      donation.creatorId,
    );
  }

  logger.info('결과 미확인 결제를 승인으로 확정', {
    donationId: donation.id,
    transactionId: txn.id,
    orderNo: txn.orderNo,
  });

  return {
    ok: true,
    message: `${donation.transactionNo} 건을 결제 승인으로 확정했습니다. 정산 원장에 분개가 추가되었습니다. 방송 송출은 수행하지 않습니다.`,
    transactionNo: donation.transactionNo,
  };
}

/** 출금이 없었던 것으로 확인된 경우. */
async function confirmCanceled(txn: TxnRow, donation: DonationRow, memo: string): Promise<ReconcileResult> {
  if (donation.status !== 'PENDING_PAYMENT') {
    throw new Error(`후원 상태가 결제 진행중(PENDING_PAYMENT)이 아닙니다. 현재 상태: ${donation.status}`);
  }

  await prisma.paymentTransaction.update({
    where: { id: txn.id },
    data: {
      status: 'CANCELED',
      canceledAt: new Date(),
      resultCode: 'ADMIN_CANCELED',
      resultMessage: `관리자 수동 취소: ${memo}`.slice(0, 500),
    },
  });
  await setStatus(donation.id, 'PAYMENT_FAILED', `관리자 수동 취소: ${memo}`, 'admin');

  // 출금이 없었으므로 결제 판정 때 잡아 둔 한도 예약을 되돌린다.
  if (donation.donorId) {
    await rollbackCounters(donation.donorId, donation.creatorId, donation.amount, txn.requestedAt);
    await sendMtForDonor(
      donation.donorId,
      tpl.tplDonationFailed(donation.creator.displayName, '결제가 완료되지 않아 취소되었습니다.'),
      donation.id,
      donation.creatorId,
    );
  }

  logger.warn('결과 미확인 결제를 취소로 확정', {
    donationId: donation.id,
    transactionId: txn.id,
    orderNo: txn.orderNo,
  });

  return {
    ok: true,
    message: `${donation.transactionNo} 건을 결제 취소로 확정했습니다. 출금이 없었던 건으로 처리되어 한도 집계도 되돌렸습니다.`,
    transactionNo: donation.transactionNo,
  };
}
