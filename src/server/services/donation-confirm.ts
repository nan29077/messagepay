import { prisma } from '@/server/db';
import { resolveSecureLink, consumeSecureLink } from './secure-link';
import { executePayment } from './donation-flow';

/**
 * CONFIRM_LINK 모드: 후원자가 MT 로 받은 링크에서 직접 확인 버튼을 눌러야 결제가 진행된다.
 * (금융사 심사 대응 기본값)
 */

export interface ConfirmContext {
  linkId: string;
  donationId: string;
  creatorName: string;
  amount: bigint;
  message: string;
  expiresAt: Date;
}

export async function loadConfirmContext(
  token: string,
): Promise<{ ok: true; ctx: ConfirmContext } | { ok: false; reason: string }> {
  const res = await resolveSecureLink(token);
  if (!res.ok) {
    const reason =
      res.reason === 'EXPIRED'
        ? '확인 시간이 지나 후원이 자동 취소되었습니다. 결제는 진행되지 않았습니다.'
        : res.reason === 'USED'
          ? '이미 처리된 요청입니다.'
          : '유효하지 않은 링크입니다.';
    return { ok: false, reason };
  }
  const link = res.link!;
  if (link.purpose !== 'CONFIRM_PAYMENT' || !link.donationId) {
    return { ok: false, reason: '용도가 다른 링크입니다.' };
  }

  const donation = await prisma.donation.findUnique({
    where: { id: link.donationId },
    include: { creator: true },
  });
  if (!donation) return { ok: false, reason: '후원 거래를 찾을 수 없습니다.' };
  if (donation.status !== 'PENDING_CONFIRM') {
    return { ok: false, reason: '이미 처리된 후원입니다.' };
  }

  return {
    ok: true,
    ctx: {
      linkId: link.id,
      donationId: donation.id,
      creatorName: donation.creator.displayName,
      amount: donation.amount,
      message: donation.message,
      expiresAt: link.expiresAt,
    },
  };
}

export async function confirmDonation(token: string, ip?: string, userAgent?: string) {
  const loaded = await loadConfirmContext(token);
  if (!loaded.ok) throw new Error(loaded.reason);

  // 링크 1회 사용 선점 (중복 클릭으로 인한 이중 결제 방지)
  const consumed = await consumeSecureLink(loaded.ctx.linkId, ip, userAgent);
  if (!consumed) throw new Error('이미 처리된 요청입니다.');

  return executePayment(loaded.ctx.donationId);
}

/** 만료된 확인 대기 건 정리 (배치) */
export async function expireStaleConfirmations(now = new Date()) {
  const stale = await prisma.secureLink.findMany({
    where: { purpose: 'CONFIRM_PAYMENT', usedAt: null, expiresAt: { lt: now }, donationId: { not: null } },
    select: { donationId: true },
  });
  let count = 0;
  for (const s of stale) {
    if (!s.donationId) continue;
    const d = await prisma.donation.findUnique({ where: { id: s.donationId }, select: { status: true } });
    if (d?.status !== 'PENDING_CONFIRM') continue;
    await prisma.donation.update({
      where: { id: s.donationId },
      data: { status: 'PAYMENT_FAILED', statusReason: '확인 시간 초과로 자동 취소' },
    });
    count += 1;
  }
  return count;
}
