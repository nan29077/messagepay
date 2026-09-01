'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/auth';
import { newId } from '@/lib/id';
import { requestRefund, approveRefund, rejectRefund } from '@/server/services/refund';
import { reconcileUnknownPayment } from '@/server/services/payment-reconcile';
import type { AdminActionState } from '@/components/admin/state';
import { run, text, optText, money, enumValue, requiredId } from './shared';

/**
 * MO 번호 재고 / 환불 / 이상거래 처리 액션.
 */

// =========================================================== MO 번호

// MO 수신번호는 050(0505/0507 등) 안심번호 체계를 사용한다.
// 가맹점마다 고유 번호를 부여하므로 형식을 강제해 오등록을 막는다.
const PHONE_RE = /^050[0-9]{7,10}$/;

export async function createMoNumber(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  return run(async (admin) => {
    // MO 수신번호는 어느 가맹점이 결제를 받을지 정하는 라우팅 설정이다.
    // 상담 등급이 바꿀 수 있으면 자기 가맹점에 번호를 붙이거나 정상 가맹점 번호를 회수할 수 있다.
    if (admin.adminPermission === 'SUPPORT') {
      throw new Error('MO 번호 관리는 운영/재무 권한에서만 가능합니다.');
    }
    const phoneNumber = text(fd, 'phoneNumber').replace(/[^0-9]/g, '');
    if (!PHONE_RE.test(phoneNumber)) throw new Error('수신번호는 050 으로 시작하는 숫자 10~13자리로 입력해 주세요. (예: 05051001001)');

    const mode = enumValue(fd, 'mode', ['DEDICATED', 'SHARED_PREFIX'] as const, '수신 모드');
    const rawKeyword = optText(fd, 'keyword');
    const keyword = rawKeyword ? rawKeyword.toUpperCase().replace(/\s+/g, '') : null;
    if (mode === 'SHARED_PREFIX' && !keyword) {
      throw new Error('대표번호 공유 모드에서는 키워드가 반드시 필요합니다.');
    }
    // 전용번호에는 키워드를 붙이지 않는다. (붙으면 유니크 키가 갈라져 중복 등록이 뚫린다)
    const effectiveKeyword = mode === 'DEDICATED' ? null : keyword;
    const monthlyCost = money(fd, 'monthlyCost', '월 비용');
    const memo = optText(fd, 'memo');

    // 같은 번호에 전용/대표번호공유가 섞이면 라우팅이 전용으로 쏠려
    // 대표번호를 쓰던 가맹점들의 결제가 통째로 엉뚱한 사람에게 들어간다.
    // 번호 단위로 먼저 검사해 모드 혼재 자체를 막는다.
    const siblings = await prisma.merchantMoNumber.findMany({
      where: { phoneNumber },
      select: { id: true, mode: true, keyword: true },
    });
    if (siblings.some((s) => s.mode !== mode)) {
      throw new Error(
        '같은 번호에 전용번호와 대표번호(키워드) 방식을 함께 등록할 수 없습니다. 기존 등록을 먼저 정리해 주세요.',
      );
    }
    if (mode === 'DEDICATED' && siblings.length > 0) {
      throw new Error('이미 등록된 전용번호입니다. 전용번호는 번호당 하나만 등록할 수 있습니다.');
    }
    if (siblings.some((s) => s.keyword === effectiveKeyword)) {
      throw new Error('이미 등록된 번호/키워드 조합입니다.');
    }

    const created = await prisma.merchantMoNumber.create({
      data: { id: newId(), phoneNumber, keyword: effectiveKeyword, mode, monthlyCost, memo, status: 'AVAILABLE' },
    });
    await writeAudit({
      adminUserId: admin.id,
      action: 'MO_NUMBER_CREATE',
      targetType: 'MerchantMoNumber',
      targetId: created.id,
      after: { phoneNumber, keyword: effectiveKeyword, mode, monthlyCost, status: 'AVAILABLE' },
    });
    revalidatePath('/admin/mo-numbers');
    return `${phoneNumber}${effectiveKeyword ? ` (${effectiveKeyword})` : ''} 번호를 재고에 등록했습니다.`;
  });
}

export async function assignMoNumber(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  return run(async (admin) => {
    // MO 수신번호는 어느 가맹점이 결제를 받을지 정하는 라우팅 설정이다.
    // 상담 등급이 바꿀 수 있으면 자기 가맹점에 번호를 붙이거나 정상 가맹점 번호를 회수할 수 있다.
    if (admin.adminPermission === 'SUPPORT') {
      throw new Error('MO 번호 관리는 운영/재무 권한에서만 가능합니다.');
    }
    const id = requiredId(fd, 'id', 'MO 번호');
    if (!optText(fd, 'merchantId')) throw new Error('배정할 가맹점을 선택해 주세요.');
    const merchantId = requiredId(fd, 'merchantId', '가맹점');

    const before = await prisma.merchantMoNumber.findUnique({ where: { id } });
    if (!before) throw new Error('MO 번호를 찾을 수 없습니다.');
    if (before.status === 'ASSIGNED') throw new Error('이미 배정된 번호입니다. 먼저 회수해 주세요.');
    if (before.status === 'DISABLED') throw new Error('사용 중지된 번호는 배정할 수 없습니다.');

    const merchant = await prisma.merchantProfile.findUnique({
      where: { id: merchantId },
      select: { id: true, displayName: true, status: true },
    });
    if (!merchant) throw new Error('가맹점을 찾을 수 없습니다.');
    if (merchant.status !== 'APPROVED') throw new Error('승인된 가맹점에만 번호를 배정할 수 있습니다.');

    await prisma.merchantMoNumber.update({
      where: { id },
      data: { status: 'ASSIGNED', merchantId, assignedAt: new Date(), releasedAt: null },
    });
    await writeAudit({
      adminUserId: admin.id,
      action: 'MO_NUMBER_ASSIGN',
      targetType: 'MerchantMoNumber',
      targetId: id,
      before: { status: before.status, merchantId: before.merchantId },
      after: { status: 'ASSIGNED', merchantId },
    });
    revalidatePath('/admin/mo-numbers');
    revalidatePath(`/admin/merchants/${merchantId}`);
    return `${before.phoneNumber} 번호를 ${merchant.displayName} 님에게 배정했습니다.`;
  });
}

export async function changeMoNumberStatus(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  return run(async (admin) => {
    // MO 수신번호는 어느 가맹점이 결제를 받을지 정하는 라우팅 설정이다.
    // 상담 등급이 바꿀 수 있으면 자기 가맹점에 번호를 붙이거나 정상 가맹점 번호를 회수할 수 있다.
    if (admin.adminPermission === 'SUPPORT') {
      throw new Error('MO 번호 관리는 운영/재무 권한에서만 가능합니다.');
    }
    const id = requiredId(fd, 'id', 'MO 번호');
    const status = enumValue(fd, 'status', ['AVAILABLE', 'RESERVED', 'RECLAIMED', 'DISABLED'] as const, '상태');

    const before = await prisma.merchantMoNumber.findUnique({ where: { id } });
    if (!before) throw new Error('MO 번호를 찾을 수 없습니다.');

    const data =
      status === 'RECLAIMED'
        ? { status, merchantId: null, releasedAt: new Date() }
        : status === 'DISABLED'
          ? { status, merchantId: null, releasedAt: new Date() }
          : { status };

    await prisma.merchantMoNumber.update({ where: { id }, data });
    await writeAudit({
      adminUserId: admin.id,
      action: `MO_NUMBER_${status}`,
      targetType: 'MerchantMoNumber',
      targetId: id,
      before: { status: before.status, merchantId: before.merchantId },
      after: data,
    });
    revalidatePath('/admin/mo-numbers');
    return `${before.phoneNumber} 번호 상태를 변경했습니다.`;
  });
}

// =========================================================== 결과 미확인 결제 수동 대사

/**
 * UNKNOWN / TIMEOUT 결제의 수동 확정.
 *
 * PG 관리자 화면에서 **실제 승인 여부를 대사한 뒤에만** 사용한다.
 *  - [결제 확정] : 출금이 확인된 건. 정산 원장에 분개가 추가된다.
 *  - [결제 취소] : 출금이 없었던 건. 결제는 실패로 확정되고 한도 집계가 되돌아간다.
 *
 * 되돌릴 수 없는 작업이므로 재무/운영 권한에서만 허용하고, 근거를 메모로 남기게 한다.
 */
export async function reconcilePaymentAction(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  return run(async (admin) => {
    if (admin.adminPermission === 'SUPPORT') {
      throw new Error('결제 수동 확정은 재무/운영 권한에서만 가능합니다.');
    }
    const transactionId = requiredId(fd, 'transactionId', '결제 거래');
    const decision = enumValue(fd, 'decision', ['APPROVE', 'CANCEL'] as const, '처리 구분');
    const memo = optText(fd, 'memo');
    if (!memo || memo.length < 2) {
      throw new Error('PG 대사 근거를 2자 이상 입력해 주세요. (예: PG 관리자 조회 결과 승인됨)');
    }

    const before = await prisma.paymentTransaction.findUnique({
      where: { id: transactionId },
      select: { id: true, orderNo: true, status: true, charge: { select: { status: true } } },
    });
    if (!before) throw new Error('결제 거래를 찾을 수 없습니다.');

    const result = await reconcileUnknownPayment(transactionId, decision, memo);

    await writeAudit({
      adminUserId: admin.id,
      action: decision === 'APPROVE' ? 'PAYMENT_RECONCILE_APPROVE' : 'PAYMENT_RECONCILE_CANCEL',
      targetType: 'PaymentTransaction',
      targetId: transactionId,
      before: { status: before.status, chargeStatus: before.charge.status },
      after: { status: decision === 'APPROVE' ? 'APPROVED' : 'CANCELED', orderNo: before.orderNo, memo },
    });
    revalidatePath('/admin/payments');
    revalidatePath('/admin/settlements');
    return result.message;
  });
}

// =========================================================== 환불

export async function approveRefundAction(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  return run(async (admin) => {
    if (admin.adminPermission === 'SUPPORT') throw new Error('환불 승인은 재무/운영 권한에서만 가능합니다.');
    const refundId = requiredId(fd, 'refundId', '환불 요청');

    const before = await prisma.refund.findUnique({
      where: { id: refundId },
      select: { id: true, status: true, amount: true, chargeId: true },
    });
    if (!before) throw new Error('환불 요청을 찾을 수 없습니다.');

    await approveRefund(refundId, admin.id);
    await writeAudit({
      adminUserId: admin.id,
      action: 'REFUND_APPROVE',
      targetType: 'Refund',
      targetId: refundId,
      before: { status: before.status },
      after: { status: 'DONE', amount: before.amount, chargeId: before.chargeId },
    });
    revalidatePath('/admin/refunds');
    revalidatePath('/admin/settlements');
    return '환불을 승인했습니다. 정산 원장에 반대 분개가 추가되었습니다.';
  });
}

export async function rejectRefundAction(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  return run(async (admin) => {
    // 승인(approveRefundAction)과 같은 기준으로 막는다. 거절만 열어 두면
    // 피해자가 올린 환불 요청을 상담 등급이 임의로 닫을 수 있다.
    if (admin.adminPermission === 'SUPPORT') {
      throw new Error('환불 처리는 운영/재무 권한에서만 가능합니다.');
    }
    const refundId = requiredId(fd, 'refundId', '환불 요청');
    const memo = optText(fd, 'memo');
    if (!memo || memo.length < 2) throw new Error('거절 사유를 2자 이상 입력해 주세요.');

    const before = await prisma.refund.findUnique({ where: { id: refundId }, select: { status: true } });
    if (!before) throw new Error('환불 요청을 찾을 수 없습니다.');
    if (before.status !== 'REQUESTED') throw new Error('요청 상태의 환불만 거절할 수 있습니다.');

    await rejectRefund(refundId, admin.id, memo);
    await writeAudit({
      adminUserId: admin.id,
      action: 'REFUND_REJECT',
      targetType: 'Refund',
      targetId: refundId,
      before: { status: before.status },
      after: { status: 'REJECTED', memo },
    });
    revalidatePath('/admin/refunds');
    return '환불 요청을 거절했습니다.';
  });
}

/** 관리자 직접 환불: 요청 생성 후 즉시 승인한다. */
export async function createAdminRefund(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  return run(async (admin) => {
    if (admin.adminPermission === 'SUPPORT') throw new Error('직접 환불은 재무/운영 권한에서만 가능합니다.');
    const keyword = text(fd, 'transactionNo');
    const reason = text(fd, 'reason');
    if (!keyword) throw new Error('거래번호를 입력해 주세요.');
    if (reason.length < 2) throw new Error('환불 사유를 2자 이상 입력해 주세요.');

    const charge = await prisma.charge.findFirst({
      where: { OR: [{ transactionNo: keyword }, { id: keyword }] },
      select: { id: true, transactionNo: true, amount: true, status: true },
    });
    if (!charge) throw new Error('해당 거래번호의 결제 건을 찾을 수 없습니다.');

    const refund = await requestRefund({ chargeId: charge.id, reason, requestedBy: admin.id });
    await approveRefund(refund.id, admin.id);

    await writeAudit({
      adminUserId: admin.id,
      action: 'REFUND_ADMIN_DIRECT',
      targetType: 'Refund',
      targetId: refund.id,
      before: { chargeStatus: charge.status },
      after: { transactionNo: charge.transactionNo, amount: charge.amount, reason },
    });
    revalidatePath('/admin/refunds');
    revalidatePath('/admin/settlements');
    return `${charge.transactionNo} 건을 환불 처리했습니다.`;
  });
}

// =========================================================== 이상거래

export async function resolveRiskDetection(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  return run(async (admin) => {
    // 이상거래를 '해결됨' 으로 닫으면 관리자 화면에서 사라진다.
    // 모니터링을 끄는 행위이므로 운영/재무 권한으로 제한한다.
    if (admin.adminPermission === 'SUPPORT') {
      throw new Error('이상거래 처리는 운영/재무 권한에서만 가능합니다.');
    }
    const riskId = requiredId(fd, 'riskId', '탐지 건');
    const before = await prisma.riskDetection.findUnique({
      where: { id: riskId },
      select: { id: true, resolved: true, type: true, level: true },
    });
    if (!before) throw new Error('탐지 건을 찾을 수 없습니다.');
    if (before.resolved) throw new Error('이미 해결 처리된 건입니다.');

    const now = new Date();
    await prisma.riskDetection.update({
      where: { id: riskId },
      data: { resolved: true, resolvedBy: admin.id, resolvedAt: now },
    });
    await writeAudit({
      adminUserId: admin.id,
      action: 'RISK_RESOLVE',
      targetType: 'RiskDetection',
      targetId: riskId,
      before: { resolved: false, type: before.type, level: before.level },
      after: { resolved: true, resolvedBy: admin.id, resolvedAt: now },
    });
    revalidatePath('/admin/risk');
    return '이상거래 탐지 건을 해결 처리했습니다.';
  });
}
