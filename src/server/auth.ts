import { cookies, headers } from 'next/headers';
import bcrypt from 'bcryptjs';
import { prisma } from '@/server/db';
import { newId } from '@/lib/id';
import { generateToken, tokenHash } from '@/lib/crypto';
import { addDays } from '@/lib/datetime';
import type { UserRole } from '@/generated/prisma/enums';

/**
 * 세션 기반 인증.
 * - 세션 토큰 원문은 쿠키에만 존재하고 DB 에는 해시만 저장한다.
 * - 관리자 화면은 role + permission 을 함께 검사한다.
 */

export const SESSION_COOKIE = 'tornado_session';
const SESSION_DAYS = 14;

export interface SessionUser {
  id: string;
  email: string | null;
  name: string | null;
  role: UserRole;
  creatorId?: string;
  adminPermission?: string;
}

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string | null) {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

export async function createSession(userId: string) {
  const token = generateToken(32);
  const h = await headers();
  await prisma.userSession.create({
    data: {
      id: newId(),
      userId,
      tokenHash: tokenHash(token),
      ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: h.get('user-agent') ?? null,
      expiresAt: addDays(new Date(), SESSION_DAYS),
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  });
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  return token;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.userSession.updateMany({
      where: { tokenHash: tokenHash(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  jar.delete(SESSION_COOKIE);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.userSession.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: {
      user: { include: { creatorProfile: true, adminProfile: true } },
    },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  const u = session.user;
  if (u.status !== 'ACTIVE') return null;

  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    creatorId: u.creatorProfile?.id,
    adminPermission: u.adminProfile?.permission,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error('로그인이 필요합니다.');
  return user;
}

export async function requireRole(role: UserRole): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== role) throw new Error('접근 권한이 없습니다.');
  return user;
}

export async function requireCreator(): Promise<SessionUser & { creatorId: string }> {
  const user = await requireUser();
  if (!user.creatorId) throw new Error('크리에이터 권한이 필요합니다.');
  return user as SessionUser & { creatorId: string };
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== 'ADMIN') throw new Error('관리자 권한이 필요합니다.');
  return user;
}

/** 관리자 변경 감사로그 */
export async function writeAudit(input: {
  adminUserId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
}) {
  const h = await headers();
  let adminProfileId: string | null = null;
  if (input.adminUserId) {
    const p = await prisma.adminProfile.findUnique({ where: { userId: input.adminUserId }, select: { id: true } });
    adminProfileId = p?.id ?? null;
  }
  await prisma.adminAuditLog.create({
    data: {
      id: newId(),
      adminId: adminProfileId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      beforeValue: (input.before ?? null) as object,
      afterValue: (input.after ?? null) as object,
      ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: h.get('user-agent') ?? null,
    },
  });
}
