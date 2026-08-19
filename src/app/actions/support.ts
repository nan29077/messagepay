'use server';

import { z } from 'zod';
import { prisma } from '@/server/db';
import { newId } from '@/lib/id';
import { getSessionUser } from '@/server/auth';
import { SUPPORT_CATEGORY_VALUES } from '@/components/public/support-options';

/**
 * 고객센터 문의 접수.
 * - 문의는 Report(status: OPEN) 로 저장한다.
 * - 거래번호를 입력하면 해당 후원 거래와 크리에이터를 연결한다.
 * - 전화번호/계좌 등 민감정보는 이 폼에서 수집하지 않는다.
 */

export interface SupportFormState {
  ok: boolean;
  message?: string;
  /** 접수번호 (Report ID) */
  ticketId?: string;
  /** 거래번호 연결 결과 안내 */
  linkNote?: string;
}

const schema = z.object({
  category: z.string().refine((v) => SUPPORT_CATEGORY_VALUES.includes(v), '문의 유형을 선택해 주세요.'),
  content: z
    .string()
    .trim()
    .min(10, '문의 내용을 10자 이상 입력해 주세요.')
    .max(2000, '문의 내용은 2,000자를 넘을 수 없습니다.'),
  transactionNo: z.string().trim().max(64, '거래번호를 확인해 주세요.'),
});

export async function submitSupportRequest(
  _prev: SupportFormState,
  formData: FormData,
): Promise<SupportFormState> {
  const parsed = schema.safeParse({
    category: String(formData.get('category') ?? ''),
    content: String(formData.get('content') ?? ''),
    transactionNo: String(formData.get('transactionNo') ?? ''),
  });

  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? '입력값을 확인해 주세요.' };
  }

  const { category, content, transactionNo } = parsed.data;

  let donationId: string | null = null;
  let creatorId: string | null = null;
  let linkNote: string | undefined;

  if (transactionNo) {
    const donation = await prisma.donation.findUnique({
      where: { transactionNo },
      select: { id: true, creatorId: true },
    });
    if (donation) {
      donationId = donation.id;
      creatorId = donation.creatorId;
      linkNote = `거래번호 ${transactionNo} 건이 문의에 연결되었습니다.`;
    } else {
      linkNote = `거래번호 ${transactionNo} 에 해당하는 후원 내역을 찾지 못해 문의만 접수했습니다. 담당자가 직접 확인합니다.`;
    }
  }

  // 로그인 사용자는 후원자 프로필의 phoneHash 로 문의자를 식별한다 (원문은 저장하지 않음)
  const user = await getSessionUser();
  let reporterHash: string | null = null;
  if (user) {
    const donor = await prisma.donorProfile.findUnique({
      where: { userId: user.id },
      select: { phoneHash: true },
    });
    reporterHash = donor?.phoneHash ?? null;
  }

  try {
    const report = await prisma.report.create({
      data: {
        id: newId(),
        category,
        content: user ? `[회원 문의 / userId=${user.id}] ${content}` : content,
        status: 'OPEN',
        donationId,
        creatorId,
        reporterHash,
      },
      select: { id: true },
    });
    return { ok: true, ticketId: report.id, linkNote };
  } catch {
    return { ok: false, message: '문의 접수 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' };
  }
}
