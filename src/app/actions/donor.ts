'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSessionUser } from '@/server/auth';
import { revokePaymentMethod } from '@/server/services/donor-registration';
import { requestRefund } from '@/server/services/refund';
import { resolvePolicy } from '@/server/services/limits';

/**
 * 후원자 마이페이지 서버 액션.
 *
 * 공통 규칙
 *  - 반드시 로그인 사용자의 DonorProfile 을 먼저 확인한다.
 *  - 모든 대상 레코드는 해당 donorId 소유인지 검증한 뒤에만 변경한다.
 */

export interface DonorActionState {
  ok: boolean;
  message?: string;
}

/** 로그인 사용자의 후원자 프로필. 없으면 null */
async function currentDonor() {
  const user = await getSessionUser();
  if (!user) return null;
  const donor = await prisma.donorProfile.findUnique({
    where: { userId: user.id },
    select: { id: true, dailyLimit: true, monthlyLimit: true },
  });
  if (!donor) return null;
  return { user, donor };
}

const NO_DONOR = '문자후원 이용 내역이 없어 처리할 수 없습니다.';
const NO_SESSION = '로그인이 필요합니다.';

// ---------------------------------------------------------------- 자동출금 해지

export async function revokeAutoWithdrawal(
  _prev: DonorActionState,
  _formData: FormData,
): Promise<DonorActionState> {
  const ctx = await currentDonor();
  if (!ctx) return { ok: false, message: NO_DONOR };

  try {
    const revoked = await revokePaymentMethod(ctx.donor.id);
    revalidatePath('/my/account');
    return revoked
      ? { ok: true, message: '자동출금 동의가 해지되었습니다. 등록된 결제수단이 폐기되었습니다.' }
      : { ok: false, message: '해지할 활성 결제수단이 없습니다.' };
  } catch {
    return { ok: false, message: '해지 처리 중 오류가 발생했습니다. 고객센터로 문의해 주세요.' };
  }
}

// ---------------------------------------------------------------- 한도 설정

const limitSchema = z.object({
  dailyLimit: z.string().trim(),
  monthlyLimit: z.string().trim(),
});

function parseLimit(input: string): bigint | null | 'INVALID' {
  const v = input.replace(/[,\s]/g, '');
  if (v === '') return null; // 미설정 = 전역 정책 사용
  if (!/^\d{1,12}$/.test(v)) return 'INVALID';
  const n = BigInt(v);
  if (n <= 0n) return 'INVALID';
  return n;
}

export async function updateDonorLimits(
  _prev: DonorActionState,
  formData: FormData,
): Promise<DonorActionState> {
  const ctx = await currentDonor();
  if (!ctx) return { ok: false, message: NO_DONOR };

  const parsed = limitSchema.safeParse({
    dailyLimit: String(formData.get('dailyLimit') ?? ''),
    monthlyLimit: String(formData.get('monthlyLimit') ?? ''),
  });
  if (!parsed.success) return { ok: false, message: '입력값을 확인해 주세요.' };

  const daily = parseLimit(parsed.data.dailyLimit);
  const monthly = parseLimit(parsed.data.monthlyLimit);
  if (daily === 'INVALID' || monthly === 'INVALID') {
    return { ok: false, message: '한도는 0보다 큰 숫자로 입력해 주세요.' };
  }

  const policy = await resolvePolicy(null, ctx.donor.id);

  // 후원자는 전역 정책보다 낮은 값만 설정할 수 있다.
  if (daily !== null && daily > policy.donorDailyLimit) {
    return { ok: false, message: '일일 한도는 기본 정책보다 높게 설정할 수 없습니다.' };
  }
  if (monthly !== null && monthly > policy.donorMonthlyLimit) {
    return { ok: false, message: '월간 한도는 기본 정책보다 높게 설정할 수 없습니다.' };
  }
  const effectiveDaily = daily ?? policy.donorDailyLimit;
  const effectiveMonthly = monthly ?? policy.donorMonthlyLimit;
  if (effectiveDaily > effectiveMonthly) {
    return { ok: false, message: '일일 한도는 월간 한도보다 클 수 없습니다.' };
  }

  await prisma.donorProfile.update({
    where: { id: ctx.donor.id },
    data: { dailyLimit: daily, monthlyLimit: monthly },
  });
  revalidatePath('/my/limits');
  return { ok: true, message: '한도가 저장되었습니다.' };
}

// ---------------------------------------------------------------- 크리에이터 차단

export async function toggleCreatorBlock(
  _prev: DonorActionState,
  formData: FormData,
): Promise<DonorActionState> {
  const ctx = await currentDonor();
  if (!ctx) return { ok: false, message: NO_DONOR };

  const linkId = String(formData.get('linkId') ?? '').trim();
  const next = String(formData.get('next') ?? '');
  if (!linkId) return { ok: false, message: '대상을 찾을 수 없습니다.' };

  // 소유권 검증: 반드시 로그인 후원자의 링크여야 한다.
  const link = await prisma.donorCreatorLink.findUnique({
    where: { id: linkId },
    select: { id: true, donorId: true, blockedAt: true, creator: { select: { displayName: true } } },
  });
  if (!link || link.donorId !== ctx.donor.id) {
    return { ok: false, message: '대상을 찾을 수 없습니다.' };
  }

  const shouldBlock = next === 'BLOCK';
  await prisma.donorCreatorLink.update({
    where: { id: link.id },
    data: { blockedAt: shouldBlock ? new Date() : null },
  });
  revalidatePath('/my/blocks');
  return {
    ok: true,
    message: shouldBlock
      ? `${link.creator.displayName} 님에 대한 후원이 차단되었습니다.`
      : `${link.creator.displayName} 님에 대한 차단이 해제되었습니다.`,
  };
}

// ---------------------------------------------------------------- 환불 요청

export async function requestDonationRefund(
  _prev: DonorActionState,
  formData: FormData,
): Promise<DonorActionState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: NO_SESSION };
  const ctx = await currentDonor();
  if (!ctx) return { ok: false, message: NO_DONOR };

  const donationId = String(formData.get('donationId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (!donationId) return { ok: false, message: '대상 거래를 찾을 수 없습니다.' };
  if (reason.length < 2) return { ok: false, message: '환불 사유를 2자 이상 입력해 주세요.' };
  if (reason.length > 300) return { ok: false, message: '환불 사유는 300자 이내로 입력해 주세요.' };

  // 소유권 검증: 반드시 로그인 후원자의 거래여야 한다.
  const donation = await prisma.donation.findUnique({
    where: { id: donationId },
    select: { id: true, donorId: true },
  });
  if (!donation || donation.donorId !== ctx.donor.id) {
    return { ok: false, message: '대상 거래를 찾을 수 없습니다.' };
  }

  try {
    await requestRefund({ donationId: donation.id, reason, requestedBy: user.id });
    revalidatePath('/my');
    return { ok: true, message: '환불 요청이 접수되었습니다. 검토 후 결과를 안내드립니다.' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '환불 요청에 실패했습니다.' };
  }
}
