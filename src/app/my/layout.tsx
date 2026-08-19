import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PublicShell } from '@/components/layout/public-shell';
import { MyNav } from '@/components/my/my-nav';
import { Card, CardTitle, LinkButton, Badge } from '@/components/ui';
import { getSessionUser } from '@/server/auth';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '마이페이지 | 토네이도',
  robots: { index: false, follow: false },
};

export default async function MyLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/my');

  const donor = await prisma.donorProfile.findUnique({
    where: { userId: user.id },
    select: { phoneMasked: true, registeredAt: true },
  });

  return (
    <PublicShell aside={<MyAside />}>
      <header className="mb-5">
        <p className="text-[12px] font-bold tracking-wide text-brand-600">마이페이지</p>
        <h1 className="mt-1 text-[24px] font-extrabold leading-snug tracking-tight text-ink-900">
          {user.name ?? '후원자'} 님
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {user.email ? <span className="text-[13px] text-ink-500">{user.email}</span> : null}
          {donor?.phoneMasked ? <Badge tone="neutral">{donor.phoneMasked}</Badge> : null}
          {donor?.registeredAt ? <Badge tone="success">계좌 등록 완료</Badge> : null}
        </div>
      </header>

      <MyNav />
      {children}
    </PublicShell>
  );
}

function MyAside() {
  return (
    <div className="sticky top-24 space-y-3">
      <Card>
        <CardTitle>안전한 이용을 위해</CardTitle>
        <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-ink-500">
          <li>한도는 기본 정책보다 낮게만 설정할 수 있습니다.</li>
          <li>자동출금 동의를 해지하면 이후 문자후원이 접수되지 않습니다.</li>
          <li>계좌번호와 전화번호는 마스킹된 값만 표시됩니다.</li>
        </ul>
      </Card>
      <Card>
        <CardTitle>도움이 필요하신가요</CardTitle>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-500">
          환불, 결제 오류, 계좌 등록 문제는 거래번호와 함께 문의해 주세요.
        </p>
        <div className="mt-3 space-y-2">
          <LinkButton href="/support" variant="secondary" size="md" className="w-full">
            고객센터 문의
          </LinkButton>
          <LinkButton href="/faq" variant="secondary" size="md" className="w-full">
            자주 묻는 질문
          </LinkButton>
        </div>
      </Card>
    </div>
  );
}
