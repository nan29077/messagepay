'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/auth';
import { newId } from '@/lib/id';
import { markSettlementPaid } from '@/server/services/settlement';
import type { AdminActionState } from '@/components/admin/state';
import { run, text, optText, money, rate, enumValue, requiredId, optDate } from './shared';
import { notifyUser } from '@/server/services/notifications';

/**
 * 정산 요청 처리 / 수수료 정책 관리.
 * 정산 원장(SettlementLedger)은 append-only 이므로 여기서 수정/삭제하지 않는다.
 */

export async function updateSettlementRequestStatus(
  _prev: AdminActionState,
  fd: FormData,
): Promise<AdminActionState> {
  return run(async (admin) => {
    if (admin.adminPermission === 'SUPPORT') throw new Error('정산 처리는 재무/운영 권한에서만 가능합니다.');
    const requestId = requiredId(fd, 'requestId', '정산 요청');
    const status = enumValue(fd, 'status', ['REVIEWING', 'APPROVED', 'PAID', 'REJECTED'] as const, '정산 상태');
    const memo = optText(fd, 'memo');

    const before = await prisma.settlementRequest.findUnique({
      where: { id: requestId },
      select: { id: true, status: true, amount: true, payoutAmount: true, creatorId: true, creator: { select: { userId: true } } },
    });
    if (!before) throw new Error('정산 요청을 찾을 수 없습니다.');
    if (before.status === 'PAID') throw new Error('이미 지급 완료된 요청입니다.');
    if (before.status === 'REJECTED') throw new Error('이미 반려된 요청입니다.');

    const now = new Date();
    if (status === 'PAID') {
      if (before.status !== 'APPROVED') throw new Error('승인된 요청만 지급 완료 처리할 수 있습니다.');
      await markSettlementPaid(requestId, admin.id);
    } else {
      const data =
        status === 'APPROVED'
          ? { status, approvedAt: now, adminId: admin.id, memo: memo ?? undefined }
          : status === 'REJECTED'
            ? { status, rejectedAt: now, adminId: admin.id, memo: memo ?? undefined }
            : { status, adminId: admin.id, memo: memo ?? undefined };
      await prisma.settlementRequest.update({ where: { id: requestId }, data });
    }

    await notifyUser({
      userId: before.creator.userId,
      title: '정산 요청 상태가 변경되었습니다',
      body: status === 'PAID' ? '요청하신 정산이 지급 완료되었습니다.' : `정산 요청이 ${status} 상태로 변경되었습니다.`,
      linkUrl: '/studio/settlement',
    });

    await writeAudit({
      adminUserId: admin.id,
      action: `SETTLEMENT_${status}`,
      targetType: 'SettlementRequest',
      targetId: requestId,
      before: { status: before.status, amount: before.amount },
      after: { status, memo, payoutAmount: before.payoutAmount },
    });
    revalidatePath('/admin/settlements');
    return status === 'PAID'
      ? '지급 완료로 처리했습니다. 원장에 PAYOUT / 원천징수 분개가 추가되었습니다.'
      : '정산 요청 상태를 변경했습니다.';
  });
}

// =========================================================== 수수료 정책

export async function createFeePolicy(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  return run(async (admin) => {
    if (admin.adminPermission === 'SUPPORT') throw new Error('수수료 정책 변경은 재무/운영 권한에서만 가능합니다.');
    const scope = enumValue(fd, 'scope', ['GLOBAL', 'CREATOR'] as const, '적용 범위');
    const creatorId = scope === 'CREATOR' ? requiredId(fd, 'creatorId', '크리에이터') : null;
    const pgFeeRate = rate(fd, 'pgFeeRate', '결제');
    const platformFeeRate = rate(fd, 'platformFeeRate', '플랫폼');
    const pgFixedFee = money(fd, 'pgFixedFee', '결제 건당 고정비');
    const smsCost = money(fd, 'smsCost', '문자 원가');
    const vatIncluded = text(fd, 'vatIncluded') === 'on';
    const effectiveFrom = optDate(fd, 'effectiveFrom', '적용 시작일') ?? new Date();

    if (creatorId) {
      const creator = await prisma.creatorProfile.findUnique({ where: { id: creatorId }, select: { id: true } });
      if (!creator) throw new Error('크리에이터를 찾을 수 없습니다.');
    }

    const previous = await prisma.feePolicy.findMany({
      where: { active: true, scope, creatorId },
      select: { id: true, pgFeeRate: true, platformFeeRate: true },
    });

    const created = await prisma.$transaction(async (tx) => {
      // 이력 보존: 기존 정책은 삭제하지 않고 마감한다.
      await tx.feePolicy.updateMany({
        where: { active: true, scope, creatorId },
        data: { active: false, effectiveTo: effectiveFrom },
      });
      return tx.feePolicy.create({
        data: {
          id: newId(),
          scope,
          creatorId,
          pgFeeRate,
          pgFixedFee,
          platformFeeRate,
          smsCost,
          vatIncluded,
          active: true,
          effectiveFrom,
        },
      });
    });

    await writeAudit({
      adminUserId: admin.id,
      action: 'FEE_POLICY_CREATE',
      targetType: 'FeePolicy',
      targetId: created.id,
      before: { closed: previous.map((p) => ({ id: p.id, pgFeeRate: p.pgFeeRate.toString(), platformFeeRate: p.platformFeeRate.toString() })) },
      after: { scope, creatorId, pgFeeRate, pgFixedFee, platformFeeRate, smsCost, vatIncluded, effectiveFrom },
    });
    revalidatePath('/admin/fees');
    return '새 수수료 정책을 등록했습니다. 기존 정책은 마감 처리되었습니다.';
  });
}

export async function deactivateFeePolicy(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  return run(async (admin) => {
    const id = requiredId(fd, 'id', '수수료 정책');
    const before = await prisma.feePolicy.findUnique({ where: { id } });
    if (!before) throw new Error('수수료 정책을 찾을 수 없습니다.');
    if (!before.active) throw new Error('이미 마감된 정책입니다.');

    await prisma.feePolicy.update({ where: { id }, data: { active: false, effectiveTo: new Date() } });
    await writeAudit({
      adminUserId: admin.id,
      action: 'FEE_POLICY_DEACTIVATE',
      targetType: 'FeePolicy',
      targetId: id,
      before: { active: true, scope: before.scope, creatorId: before.creatorId },
      after: { active: false },
    });
    revalidatePath('/admin/fees');
    return '수수료 정책을 마감했습니다.';
  });
}
