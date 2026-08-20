import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ConsoleShell, type NavGroup } from '@/components/layout/console-shell';
import { requireAdmin, type SessionUser } from '@/server/auth';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '통합 관리자 | 도네이도',
  robots: { index: false, follow: false },
};

const groups: NavGroup[] = [
  {
    title: '운영현황',
    items: [
      { href: '/admin', label: '대시보드' },
      { href: '/admin/system', label: '시스템 상태' },
    ],
  },
  {
    title: '회원·크리에이터',
    items: [
      { href: '/admin/users', label: '회원' },
      { href: '/admin/donors', label: '후원자' },
      { href: '/admin/creators', label: '크리에이터 심사' },
      { href: '/admin/codes', label: '크리에이터 코드' },
      { href: '/admin/mo-numbers', label: 'MO 번호' },
    ],
  },
  {
    title: '거래',
    items: [
      { href: '/admin/mo-messages', label: '수신 문자' },
      { href: '/admin/mt-messages', label: 'MT 발송' },
      { href: '/admin/payments', label: '결제' },
      { href: '/admin/refunds', label: '환불' },
      { href: '/admin/risk', label: '한도·이상거래' },
    ],
  },
  {
    title: '방송',
    items: [
      { href: '/admin/youtube', label: '유튜브 연동' },
      { href: '/admin/streams', label: '방송·스트림' },
      { href: '/admin/tts', label: 'TTS 연동' },
      { href: '/admin/overlay', label: '오버레이' },
    ],
  },
  {
    title: '정산·정책·운영',
    items: [
      { href: '/admin/settlements', label: '정산' },
      { href: '/admin/fees', label: '수수료 정책' },
      { href: '/admin/policies', label: '한도 정책' },
      { href: '/admin/banners', label: '배너' },
      { href: '/admin/contents', label: '공지·FAQ' },
      { href: '/admin/moderation', label: '신고·금칙어' },
      { href: '/admin/inquiries', label: '문의 관리' },
      { href: '/admin/terms', label: '약관 버전' },
      { href: '/admin/admins', label: '관리자 권한' },
      { href: '/admin/audit', label: '감사로그' },
      { href: '/admin/simulator', label: 'MO 시뮬레이터' },
    ],
  },
];

const permissionLabel: Record<string, string> = {
  SUPER_ADMIN: '최고 관리자',
  OPERATION: '운영',
  FINANCE: '재무',
  SUPPORT: '고객지원',
  READ_ONLY: '읽기 전용',
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let admin: SessionUser | null = null;
  try {
    admin = await requireAdmin();
  } catch {
    admin = null;
  }
  if (!admin) redirect('/login?next=/admin');

  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.href !== '/admin/inquiries' || admin?.adminPermission === 'SUPER_ADMIN'),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <ConsoleShell
      title="도네이도 통합 관리자"
      groups={visibleGroups}
      user={{
        name: admin.name ?? admin.email ?? '관리자',
        role: permissionLabel[admin.adminPermission ?? ''] ?? '권한 미지정',
      }}
    >
      {children}
    </ConsoleShell>
  );
}
