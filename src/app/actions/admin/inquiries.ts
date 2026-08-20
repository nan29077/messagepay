'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/auth';
import { newId } from '@/lib/id';
import type { AdminActionState } from '@/components/admin/state';
import { run, text, requiredId, enumValue } from './shared';
import { notifyUser } from '@/server/services/notifications';

/**
 * 1:1 문의 관리 (통합 관리자).
 * - 답변 등록 시 상태가 ANSWERED 로 바뀌고, 사용자가 다시 메시지를 보내면 OPEN 으로 돌아온다.
 * - 종결(CLOSED)한 문의도 사용자가 새 메시지를 보내면 다시 접수된다.
 */

export async function replyInquiry(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  return run(async (admin) => {
    if (admin.adminPermission !== 'SUPER_ADMIN') throw new Error('문의 관리는 최고 관리자만 처리할 수 있습니다.');
    const inquiryId = requiredId(fd, 'inquiryId', '문의');
    const body = text(fd, 'body').trim();
    if (!body) throw new Error('답변 내용을 입력해 주세요.');
    if (body.length > 2000) throw new Error('답변은 2,000자 이내로 입력해 주세요.');

    const inquiry = await prisma.supportInquiry.findUnique({ where: { id: inquiryId }, select: { id: true, userId: true } });
    if (!inquiry) throw new Error('문의를 찾을 수 없습니다.');

    await prisma.$transaction([
      prisma.supportMessage.create({
        data: { id: newId(), inquiryId, sender: 'ADMIN', body, readByAdminAt: new Date() },
      }),
      prisma.supportInquiry.update({
        where: { id: inquiryId },
        data: { status: 'ANSWERED', lastMessageAt: new Date() },
      }),
    ]);

    if (inquiry.userId) {
      await notifyUser({
        userId: inquiry.userId,
        title: '1:1 문의에 답변이 등록되었습니다',
        body: body.slice(0, 120),
        linkUrl: '/',
      });
    }

    await writeAudit({
      adminUserId: admin.id,
      action: 'INQUIRY_REPLY',
      targetType: 'SupportInquiry',
      targetId: inquiryId,
      after: { bodyLength: body.length },
    });

    revalidatePath('/admin/inquiries');
    revalidatePath(`/admin/inquiries/${inquiryId}`);
    return '답변을 등록했습니다. 사용자 문의 창에 바로 표시됩니다.';
  });
}

export async function setInquiryStatus(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  return run(async (admin) => {
    if (admin.adminPermission !== 'SUPER_ADMIN') throw new Error('문의 관리는 최고 관리자만 처리할 수 있습니다.');
    const inquiryId = requiredId(fd, 'inquiryId', '문의');
    const status = enumValue(fd, 'status', ['OPEN', 'ANSWERED', 'CLOSED'] as const, '상태');

    const before = await prisma.supportInquiry.findUnique({
      where: { id: inquiryId },
      select: { id: true, status: true },
    });
    if (!before) throw new Error('문의를 찾을 수 없습니다.');

    await prisma.supportInquiry.update({ where: { id: inquiryId }, data: { status } });
    await writeAudit({
      adminUserId: admin.id,
      action: 'INQUIRY_STATUS_UPDATE',
      targetType: 'SupportInquiry',
      targetId: inquiryId,
      before: { status: before.status },
      after: { status },
    });

    revalidatePath('/admin/inquiries');
    revalidatePath(`/admin/inquiries/${inquiryId}`);
    return status === 'CLOSED' ? '문의를 종결 처리했습니다.' : '문의 상태를 변경했습니다.';
  });
}

/** 문의를 읽음 처리한다 (상세 화면 진입 시 사용). */
export async function markInquiryRead(inquiryId: string): Promise<void> {
  const { requireAdmin } = await import('@/server/auth');
  const admin = await requireAdmin();
  if (admin.adminPermission !== 'SUPER_ADMIN') throw new Error('문의 관리는 최고 관리자만 확인할 수 있습니다.');
  await prisma.supportMessage.updateMany({
    where: { inquiryId, sender: 'USER', readByAdminAt: null },
    data: { readByAdminAt: new Date() },
  });
}
