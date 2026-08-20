import type { Metadata } from 'next';
import { PublicShell } from '@/components/layout/public-shell';
import { PageHeader } from '@/components/public/page-header';
import { TermsArticle, TermsNav } from '@/components/public/terms-article';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '서비스 이용약관 | 도네이도',
  description: '도네이도 문자후원 서비스 이용약관입니다.',
};

export default async function TermsPage() {
  const doc = await prisma.termsVersion.findFirst({
    where: { type: 'TERMS_SERVICE', active: true },
    orderBy: { effectiveFrom: 'desc' },
  });

  return (
    <PublicShell>
      <PageHeader eyebrow="약관" title="서비스 이용약관" description="도네이도 문자후원 서비스의 이용조건과 절차입니다." />
      <TermsNav current="terms" />
      <TermsArticle doc={doc} />
    </PublicShell>
  );
}
