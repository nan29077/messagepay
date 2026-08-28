'use server';

import { headers } from 'next/headers';
import { prisma } from '@/server/db';
import { loadConfirmContext, confirmDonation } from '@/server/services/donation-confirm';
import { clientIpFrom } from '@/server/rate-limit';
import { checkDonorName } from '@/lib/donor-name';
import { validateDonorName } from '@/server/services/donor-name';

/**
 * 문자후원 결제 확인 서버 액션.
 * - 보안링크는 1회용이므로 서버에서 중복 클릭이 방어된다.
 * - 결제가 실패하면 실패로 그대로 안내한다. 실패 건은 방송에 노출되지 않는다.
 */

export interface ConfirmActionResult {
  ok: boolean;
  message: string;
  /** 대외 노출용 거래번호 (성공 시에만) */
  transactionNo?: string;
}

export async function confirmDonationAction(token: string): Promise<ConfirmActionResult> {
  const h = await headers();
  const ip = clientIpFrom((name) => h.get(name)) ?? undefined;
  const userAgent = h.get('user-agent') ?? undefined;

  const loaded = await loadConfirmContext(String(token ?? ''));
  if (!loaded.ok) {
    return { ok: false, message: loaded.reason };
  }
  const donationId = loaded.ctx.donationId;

  try {
    const outcome = await confirmDonation(token, ip, userAgent);
    if (!outcome.ok) {
      return { ok: false, message: outcome.message || '결제가 완료되지 않았습니다.' };
    }
    const donation = await prisma.donation.findUnique({
      where: { id: donationId },
      select: { transactionNo: true },
    });
    return {
      ok: true,
      message: outcome.message || '후원이 완료되었습니다.',
      transactionNo: donation?.transactionNo,
    };
  } catch (e) {
    return { ok: false, message: (e as Error).message || '결제 처리 중 오류가 발생했습니다.' };
  }
}

export interface NicknameUpdateResult {
  ok: boolean;
  message?: string;
}

/**
 * PIN 입력 화면에서 후원자 닉네임·SNS 플랫폼을 저장/수정한다.
 * 닉네임이 비어 있으면 아무것도 하지 않는다(기존 값 유지).
 */
export async function updateDonorNicknameAction(
  donorId: string,
  nickname: string,
  snsPlatform?: string,
): Promise<NicknameUpdateResult> {
  const trimmed = nickname.trim();
  if (!trimmed) return { ok: true }; // 빈 값 = 변경 없음

  const clientCheck = checkDonorName(trimmed);
  if (!clientCheck.ok) return { ok: false, message: clientCheck.message };

  try {
    const serverCheck = await validateDonorName(trimmed);
    if (!serverCheck.ok) return { ok: false, message: serverCheck.message ?? '닉네임을 다시 입력해 주세요.' };

    await prisma.donorProfile.update({
      where: { id: donorId },
      data: {
        displayName: serverCheck.value,
        snsPlatform: snsPlatform?.trim() || null,
      },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message || '닉네임 저장에 실패했습니다.' };
  }
}
