'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/auth';
import { newId, newCreatorCode } from '@/lib/id';
import { env } from '@/lib/env';
import type { AdminActionState } from '@/components/admin/state';
import { run, text, optText, optMoney, enumValue, requiredId } from './shared';

/**
 * 회원 / 후원자 / 크리에이터 / 코드 / 관리자 권한 관련 서버 액션.
 * 모든 변경은 writeAudit 으로 변경 전/후 값을 남긴다.
 */

// =========================================================== 회원 상태

export async function updateUserStatus(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  return run(async (admin) => {
    const userId = requiredId(fd, 'userId', '회원');
    const status = enumValue(fd, 'status', ['ACTIVE', 'SUSPENDED', 'WITHDRAWN'] as const, '회원 상태');

    const before = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, status: true, role: true },
    });
    if (!before) throw new Error('회원을 찾을 수 없습니다.');
    if (before.id === admin.id) throw new Error('본인 계정의 상태는 변경할 수 없습니다.');
    if (before.status === status) throw new Error('이미 해당 상태입니다.');

    await prisma.user.update({ where: { id: userId }, data: { status } });
    if (status !== 'ACTIVE') {
      // 상태가 내려가면 활성 세션을 즉시 만료시킨다.
      await prisma.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await writeAudit({
      adminUserId: admin.id,
      action: 'USER_STATUS_UPDATE',
      targetType: 'User',
      targetId: userId,
      before: { status: before.status },
      after: { status },
    });
    revalidatePath('/admin/users');
    return `${before.email ?? userId} 회원 상태를 변경했습니다.`;
  });
}

// =========================================================== 후원자

export async function unlockDonor(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  return run(async (admin) => {
    const donorId = requiredId(fd, 'donorId', '후원자');
    const before = await prisma.donorProfile.findUnique({
      where: { id: donorId },
      select: { id: true, phoneMasked: true, failCount: true, lockedUntil: true },
    });
    if (!before) throw new Error('후원자를 찾을 수 없습니다.');

    await prisma.donorProfile.update({
      where: { id: donorId },
      data: { lockedUntil: null, failCount: 0 },
    });
    await writeAudit({
      adminUserId: admin.id,
      action: 'DONOR_UNLOCK',
      targetType: 'DonorProfile',
      targetId: donorId,
      before: { lockedUntil: before.lockedUntil, failCount: before.failCount },
      after: { lockedUntil: null, failCount: 0 },
    });
    revalidatePath('/admin/donors');
    revalidatePath(`/admin/donors/${donorId}`);
    return `${before.phoneMasked} 후원자의 결제 실패 잠금을 해제했습니다.`;
  });
}

export async function setDonorBlock(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  return run(async (admin) => {
    const donorId = requiredId(fd, 'donorId', '후원자');
    const next = enumValue(fd, 'next', ['BLOCK', 'UNBLOCK'] as const, '처리 구분');
    const reason = optText(fd, 'reason');
    if (next === 'BLOCK' && (!reason || reason.length < 2)) {
      throw new Error('이용 제한 사유를 2자 이상 입력해 주세요.');
    }

    const before = await prisma.donorProfile.findUnique({
      where: { id: donorId },
      select: { id: true, phoneMasked: true, blockedAt: true, blockedReason: true },
    });
    if (!before) throw new Error('후원자를 찾을 수 없습니다.');

    const after =
      next === 'BLOCK'
        ? { blockedAt: new Date(), blockedReason: reason }
        : { blockedAt: null, blockedReason: null };

    await prisma.donorProfile.update({ where: { id: donorId }, data: after });
    await writeAudit({
      adminUserId: admin.id,
      action: next === 'BLOCK' ? 'DONOR_BLOCK' : 'DONOR_UNBLOCK',
      targetType: 'DonorProfile',
      targetId: donorId,
      before: { blockedAt: before.blockedAt, blockedReason: before.blockedReason },
      after,
    });
    revalidatePath('/admin/donors');
    revalidatePath(`/admin/donors/${donorId}`);
    return next === 'BLOCK'
      ? `${before.phoneMasked} 후원자의 이용을 제한했습니다.`
      : `${before.phoneMasked} 후원자의 이용 제한을 해제했습니다.`;
  });
}

export async function updateDonorLimitsByAdmin(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  return run(async (admin) => {
    const donorId = requiredId(fd, 'donorId', '후원자');
    const dailyLimit = optMoney(fd, 'dailyLimit', '일일 한도');
    const monthlyLimit = optMoney(fd, 'monthlyLimit', '월간 한도');
    if (dailyLimit !== null && monthlyLimit !== null && dailyLimit > monthlyLimit) {
      throw new Error('일일 한도는 월간 한도보다 클 수 없습니다.');
    }

    const before = await prisma.donorProfile.findUnique({
      where: { id: donorId },
      select: { id: true, phoneMasked: true, dailyLimit: true, monthlyLimit: true },
    });
    if (!before) throw new Error('후원자를 찾을 수 없습니다.');

    await prisma.donorProfile.update({ where: { id: donorId }, data: { dailyLimit, monthlyLimit } });
    await writeAudit({
      adminUserId: admin.id,
      action: 'DONOR_LIMIT_UPDATE',
      targetType: 'DonorProfile',
      targetId: donorId,
      before: { dailyLimit: before.dailyLimit, monthlyLimit: before.monthlyLimit },
      after: { dailyLimit, monthlyLimit },
    });
    revalidatePath('/admin/donors');
    revalidatePath(`/admin/donors/${donorId}`);
    return `${before.phoneMasked} 후원자의 개인 한도를 저장했습니다.`;
  });
}

// =========================================================== 크리에이터 심사

export async function updateCreatorStatus(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  return run(async (admin) => {
    const creatorId = requiredId(fd, 'creatorId', '크리에이터');
    const status = enumValue(fd, 'status', ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const, '심사 상태');

    const before = await prisma.creatorProfile.findUnique({
      where: { id: creatorId },
      select: { id: true, displayName: true, status: true, approvedAt: true, suspendedAt: true },
    });
    if (!before) throw new Error('크리에이터를 찾을 수 없습니다.');

    const now = new Date();
    const data =
      status === 'APPROVED'
        ? { status, approvedAt: before.approvedAt ?? now, suspendedAt: null }
        : status === 'SUSPENDED'
          ? { status, suspendedAt: now }
          : { status };

    await prisma.creatorProfile.update({ where: { id: creatorId }, data });
    await writeAudit({
      adminUserId: admin.id,
      action: 'CREATOR_STATUS_UPDATE',
      targetType: 'CreatorProfile',
      targetId: creatorId,
      before: { status: before.status, approvedAt: before.approvedAt, suspendedAt: before.suspendedAt },
      after: data,
    });
    revalidatePath('/admin/creators');
    revalidatePath(`/admin/creators/${creatorId}`);
    return status === 'APPROVED'
      ? `${before.displayName} 님을 승인했습니다. MO 번호 배정을 이어서 진행해 주세요.`
      : `${before.displayName} 님의 심사 상태를 변경했습니다.`;
  });
}

export async function updateCreatorPaymentMode(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  return run(async (admin) => {
    const creatorId = requiredId(fd, 'creatorId', '크리에이터');
    const raw = text(fd, 'paymentMode');
    if (!['', 'CONFIRM_LINK', 'DIRECT_TRIGGER'].includes(raw)) throw new Error('결제 모드 값이 올바르지 않습니다.');
    const paymentMode = raw === '' ? null : (raw as 'CONFIRM_LINK' | 'DIRECT_TRIGGER');

    if (paymentMode === 'DIRECT_TRIGGER' && !env.safety.allowDirectTrigger) {
      throw new Error('금융사 서면승인이 등록되지 않아 즉시형 결제를 활성화할 수 없습니다.');
    }

    const before = await prisma.creatorProfile.findUnique({
      where: { id: creatorId },
      select: { id: true, displayName: true, paymentMode: true },
    });
    if (!before) throw new Error('크리에이터를 찾을 수 없습니다.');

    await prisma.creatorProfile.update({ where: { id: creatorId }, data: { paymentMode } });
    await writeAudit({
      adminUserId: admin.id,
      action: 'CREATOR_PAYMENT_MODE_UPDATE',
      targetType: 'CreatorProfile',
      targetId: creatorId,
      before: { paymentMode: before.paymentMode },
      after: { paymentMode, allowDirectTrigger: env.safety.allowDirectTrigger },
    });
    revalidatePath(`/admin/creators/${creatorId}`);
    return `${before.displayName} 님의 결제 모드를 ${paymentMode ?? '전역 설정'} 으로 변경했습니다.`;
  });
}

// =========================================================== 크리에이터 코드

async function generateUniqueCode(): Promise<string> {
  for (let i = 0; i < 30; i += 1) {
    const candidate = newCreatorCode();
    const [dupCode, dupProfile] = await Promise.all([
      prisma.creatorCode.findUnique({ where: { code: candidate }, select: { id: true } }),
      prisma.creatorProfile.findUnique({ where: { code: candidate }, select: { id: true } }),
    ]);
    if (!dupCode && !dupProfile) return candidate;
  }
  throw new Error('사용 가능한 코드를 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.');
}

export async function reissueCreatorCode(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  return run(async (admin) => {
    const creatorId = requiredId(fd, 'creatorId', '크리에이터');
    const before = await prisma.creatorProfile.findUnique({
      where: { id: creatorId },
      select: { id: true, displayName: true, code: true },
    });
    if (!before) throw new Error('크리에이터를 찾을 수 없습니다.');

    const nextCode = await generateUniqueCode();
    const now = new Date();

    await prisma.$transaction([
      prisma.creatorCode.updateMany({
        where: { creatorId, active: true },
        data: { active: false, revokedAt: now },
      }),
      prisma.creatorCode.create({
        data: { id: newId(), creatorId, code: nextCode, active: true, issuedAt: now },
      }),
      prisma.creatorProfile.update({ where: { id: creatorId }, data: { code: nextCode } }),
    ]);

    await writeAudit({
      adminUserId: admin.id,
      action: 'CREATOR_CODE_REISSUE',
      targetType: 'CreatorProfile',
      targetId: creatorId,
      before: { code: before.code },
      after: { code: nextCode },
    });
    revalidatePath('/admin/codes');
    revalidatePath(`/admin/creators/${creatorId}`);
    return `${before.displayName} 님의 코드를 ${nextCode} 로 재발급했습니다. 기존 링크(/c/${before.code})는 더 이상 동작하지 않습니다.`;
  });
}

// =========================================================== 관리자 권한

export async function updateAdminPermission(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  return run(async (admin) => {
    if (admin.adminPermission !== 'SUPER_ADMIN') {
      throw new Error('관리자 권한 변경은 SUPER_ADMIN 만 수행할 수 있습니다.');
    }
    const profileId = requiredId(fd, 'profileId', '관리자');
    const permission = enumValue(
      fd,
      'permission',
      ['SUPER_ADMIN', 'OPERATION', 'FINANCE', 'SUPPORT', 'READ_ONLY'] as const,
      '권한',
    );

    const before = await prisma.adminProfile.findUnique({
      where: { id: profileId },
      select: { id: true, permission: true, userId: true, user: { select: { email: true } } },
    });
    if (!before) throw new Error('관리자를 찾을 수 없습니다.');
    if (before.userId === admin.id && permission !== before.permission) {
      throw new Error('본인의 권한은 변경할 수 없습니다. 다른 SUPER_ADMIN 에게 요청해 주세요.');
    }
    if (before.permission === permission) throw new Error('이미 해당 권한입니다.');

    if (before.permission === 'SUPER_ADMIN' && permission !== 'SUPER_ADMIN') {
      const superCount = await prisma.adminProfile.count({ where: { permission: 'SUPER_ADMIN' } });
      if (superCount <= 1) throw new Error('마지막 SUPER_ADMIN 의 권한은 강등할 수 없습니다.');
    }

    await prisma.adminProfile.update({ where: { id: profileId }, data: { permission } });
    await writeAudit({
      adminUserId: admin.id,
      action: 'ADMIN_PERMISSION_UPDATE',
      targetType: 'AdminProfile',
      targetId: profileId,
      before: { permission: before.permission },
      after: { permission },
    });
    revalidatePath('/admin/admins');
    return `${before.user.email ?? profileId} 의 권한을 ${permission} 으로 변경했습니다.`;
  });
}
