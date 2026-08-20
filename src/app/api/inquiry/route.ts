import { cookies } from 'next/headers';
import { prisma } from '@/server/db';
import { getSessionUser } from '@/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 내 1:1 문의 스레드 조회 (위젯 폴링용).
 * 로그인 사용자는 세션으로, 비로그인 사용자는 httpOnly 게스트 쿠키로 식별한다.
 * 다른 사람의 문의는 어떤 경로로도 조회할 수 없다.
 */

const GUEST_COOKIE = 'donaido_inquiry';

export async function GET(request: Request) {
  const user = await getSessionUser().catch(() => null);
  const jar = await cookies();
  const guestToken = jar.get(GUEST_COOKIE)?.value ?? null;

  const inquiry = user
    ? await prisma.supportInquiry.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } })
    : guestToken
      ? await prisma.supportInquiry.findUnique({ where: { guestToken } })
      : null;

  if (!inquiry) {
    return Response.json({ exists: false, status: null, unreadCount: 0, messages: [] });
  }

  const peek = new URL(request.url).searchParams.get('peek') === '1';
  const unreadCount = await prisma.supportMessage.count({
    where: { inquiryId: inquiry.id, sender: 'ADMIN', readByUserAt: null },
  });

  const messages = await prisma.supportMessage.findMany({
    where: { inquiryId: inquiry.id },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: { id: true, sender: true, body: true, createdAt: true },
  });

  // 관리자 답변 읽음 처리
  if (!peek && unreadCount > 0) {
    await prisma.supportMessage.updateMany({
      where: { inquiryId: inquiry.id, sender: 'ADMIN', readByUserAt: null },
      data: { readByUserAt: new Date() },
    });
  }

  return Response.json({
    exists: true,
    status: inquiry.status,
    unreadCount,
    messages: messages.map((m) => ({
      id: m.id,
      sender: m.sender,
      body: m.body,
      at: m.createdAt.toISOString(),
    })),
  });
}
