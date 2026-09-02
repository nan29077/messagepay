import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ConsoleShell, type NavGroup } from '@/components/layout/console-shell';
import { getSessionUser, requireMerchant } from '@/server/auth';
import { prisma } from '@/server/db';
import { PAID_STATUSES } from '@/components/studio/shared';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '가맹점 관리자',
  robots: { index: false, follow: false },
};

/**
 * 가맹점 메뉴.
 *
 * 판매 업무를 흐름대로 묶는다: 무엇을 파는가(상품 관리) → 어떻게 처리하는가(주문·판매)
 * → 어떤 조건으로 파는가(판매 설정). 배송 정책은 상품이 아니라 판매 설정에 있다.
 *
 * 처리 대기 건수는 매 요청마다 세어 뱃지로 붙인다.
 */
function buildGroups(pending: { orders: number; points: number; reports: number }): NavGroup[] {
  return [
    {
      title: '현황',
      items: [
        { href: '/studio', label: '대시보드', icon: 'dashboard' },
        { href: '/studio/charges', label: '결제 내역', icon: 'charges' },
        { href: '/studio/messages', label: '문자 관리', icon: 'messages' },
      ],
    },
    {
      title: '판매',
      items: [
        { href: '/studio/products', label: '상품 관리', icon: 'products' },
        {
          href: '/studio/orders',
          label: '주문·판매',
          icon: 'orders',
          badge: pending.orders + pending.points,
        },
        { href: '/studio/settings', label: '판매 설정', icon: 'settings' },
        { href: '/studio/moderation', label: '금칙어·차단', icon: 'moderation' },
        { href: '/studio/reports', label: '신고', icon: 'reports', badge: pending.reports },
      ],
    },
    {
      title: '정산',
      items: [
        { href: '/studio/settlement', label: '정산 관리', icon: 'settlement' },
      ],
    },
    {
      title: '계정',
      items: [{ href: '/studio/profile', label: '프로필 설정', icon: 'profile' }],
    },
  ];
}

const STATUS_NOTICE: Record<string, { title: string; body: string }> = {
  PENDING: {
    title: '채널 심사가 진행 중입니다',
    body: '가입해 주셔서 감사합니다. 담당자가 채널 정보를 확인하고 있으며, 승인이 완료되면 등록하신 연락처로 안내드립니다. 승인 후 스튜디오의 모든 기능을 사용하실 수 있습니다.',
  },
  REJECTED: {
    title: '채널 심사가 반려되었습니다',
    body: '제출하신 채널 정보로는 승인이 어려웠습니다. 사유 확인과 재심사 요청은 고객센터 문의로 접수해 주세요.',
  },
  SUSPENDED: {
    title: '채널이 정지되었습니다',
    body: '운영정책 위반 또는 관리자 조치로 채널이 정지된 상태입니다. 정지 사유와 해제 절차는 고객센터로 문의해 주세요.',
  },
};

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionUser().catch(() => null);
  if (!session?.merchantId) redirect('/login?next=/studio');

  // 미승인·반려·정지 채널은 스튜디오 기능 대신 상태 안내만 노출한다.
  if (session.merchantStatus !== 'APPROVED') {
    const notice = STATUS_NOTICE[session.merchantStatus ?? 'PENDING'] ?? STATUS_NOTICE.PENDING;
    return (
      <div className="console-canvas mx-auto flex min-h-screen max-w-[560px] flex-col justify-center px-5 py-16">
        <div className="card p-7">
          <h1 className="text-[19px] font-bold text-ink-900">{notice.title}</h1>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-500">{notice.body}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link href="/" className="rounded-xl bg-ink-900 px-4 py-2.5 text-[13px] font-semibold text-white">
              메인으로
            </Link>
            <Link href="/support" className="rounded-xl border border-ink-200 px-4 py-2.5 text-[13px] font-semibold text-ink-700">
              고객센터 문의
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const user = await requireMerchant().catch(() => null);
  if (!user) redirect('/login?next=/studio');

  // 밀린 일을 메뉴에서 바로 보이게 한다. 세 번의 count 는 인덱스가 있어 가볍다.
  const [ordersPending, pointsPending, reportsOpen] = await Promise.all([
    prisma.chargeShipment.count({
      where: { merchantId: user.merchantId, status: 'PREPARING', charge: { status: { in: PAID_STATUSES } } },
    }),
    prisma.charge.count({
      where: {
        merchantId: user.merchantId,
        status: { in: PAID_STATUSES },
        pointStatus: 'PENDING',
        product: { kind: 'DIGITAL' },
      },
    }),
    prisma.report.count({ where: { merchantId: user.merchantId, status: 'OPEN' } }),
  ]);

  return (
    <ConsoleShell
      title="가맹점 관리자"
      groups={buildGroups({ orders: ordersPending, points: pointsPending, reports: reportsOpen })}
      user={{
        id: user.id,
        name: user.name ?? '가맹점',
        role: '가맹점',
        avatarUrl: user.merchantAvatarUrl,
        avatarSeed: user.merchantCode ?? user.id,
        avatarIndex: user.avatarIndex,
      }}
    >
      {children}
    </ConsoleShell>
  );
}
