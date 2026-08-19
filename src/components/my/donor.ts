import { redirect } from 'next/navigation';
import { prisma } from '@/server/db';
import { getSessionUser, type SessionUser } from '@/server/auth';

/**
 * 마이페이지 공통 로더.
 * - 로그인하지 않았으면 /login 으로 보낸다.
 * - DonorProfile 은 문자후원(MO) 수신 시 생성되므로 회원가입만 한 계정에는 없을 수 있다.
 */

export interface DonorContext {
  user: SessionUser;
  donorId: string | null;
}

export async function requireDonorContext(next = '/my'): Promise<DonorContext> {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);

  const donor = await prisma.donorProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });

  return { user, donorId: donor?.id ?? null };
}

export const NO_DONOR_TITLE = '문자후원 이용 내역이 없습니다';
export const NO_DONOR_DESC =
  '이 계정으로 접수된 문자후원이 없습니다. 크리에이터의 후원 번호로 문자를 보내고 계좌 등록을 완료하면 이곳에서 내역을 확인할 수 있습니다.';
