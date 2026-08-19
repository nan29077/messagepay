import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ConsoleShell, type NavGroup } from '@/components/layout/console-shell';
import { requireCreator } from '@/server/auth';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '크리에이터 관리자 | 토네이도',
  robots: { index: false, follow: false },
};

const groups: NavGroup[] = [
  {
    title: '현황',
    items: [
      { href: '/studio', label: '대시보드' },
      { href: '/studio/donations', label: '후원 내역' },
      { href: '/studio/messages', label: '문자 관리' },
    ],
  },
  {
    title: '방송',
    items: [
      { href: '/studio/youtube', label: '유튜브 연동' },
      { href: '/studio/overlay', label: '오버레이 설정' },
      { href: '/studio/tts', label: 'TTS 설정' },
      { href: '/studio/stream', label: '자체 방송' },
    ],
  },
  {
    title: '운영',
    items: [
      { href: '/studio/settings', label: '후원 설정' },
      { href: '/studio/moderation', label: '금칙어·차단' },
      { href: '/studio/reports', label: '신고' },
    ],
  },
  {
    title: '정산',
    items: [
      { href: '/studio/settlement', label: '정산 관리' },
      { href: '/studio/settlement/account', label: '정산 계좌' },
    ],
  },
  {
    title: '계정',
    items: [{ href: '/studio/profile', label: '프로필·코드' }],
  },
];

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const user = await requireCreator().catch(() => null);
  if (!user) redirect('/login?next=/studio');

  return (
    <ConsoleShell
      title="크리에이터 관리자"
      groups={groups}
      user={{ name: user.name ?? '크리에이터', role: '크리에이터' }}
    >
      {children}
    </ConsoleShell>
  );
}
