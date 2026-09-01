import type { Metadata } from 'next';
import { PublicShell } from '@/components/layout/public-shell';
import { PageHeader } from '@/components/public/page-header';
import { TermsArticle, TermsNav } from '@/components/public/terms-article';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '서비스 이용약관',
  description: '메시지페이 문자결제 서비스 이용약관입니다.',
};

export default async function TermsPage() {
  const doc = await prisma.termsVersion.findFirst({
    // 시행일이 오지 않은 개정안을 현행 약관으로 보여주면 안 된다.
    where: { type: 'TERMS_SERVICE', active: true, effectiveFrom: { lte: new Date() } },
    orderBy: { effectiveFrom: 'desc' },
  });

  return (
    <PublicShell>
      <PageHeader eyebrow="약관" title="서비스 이용약관" description="메시지페이 문자결제 서비스의 이용조건과 절차입니다." />
      <TermsNav current="terms" />
      <TermsArticle doc={doc} />
    </PublicShell>
  );
}
