import type { Metadata } from 'next';
import { PublicShell } from '@/components/layout/public-shell';
import { PageHeader } from '@/components/public/page-header';
import { TermsArticle, TermsNav } from '@/components/public/terms-article';
import { Notice } from '@/components/ui';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '전자금융거래 이용약관 | 토네이도',
  description: '전자금융거래의 이용조건, 거래내용 확인, 오류 정정 절차를 안내합니다.',
};

export default async function EFinanceTermsPage() {
  const doc = await prisma.termsVersion.findFirst({
    where: { type: 'E_FINANCE', active: true },
    orderBy: { effectiveFrom: 'desc' },
  });

  return (
    <PublicShell>
      <PageHeader
        eyebrow="약관"
        title="전자금융거래 이용약관"
        description="출금이체 방식의 문자후원 결제에 적용되는 약관입니다."
      />
      <TermsNav current="e-finance" />
      <TermsArticle doc={doc} />
      <div className="mt-4">
        <Notice tone="warning" title="출금이체 동의 안내">
          계좌 등록 시 출금이체에 동의하면, 이후 보내는 문자에 대해 등록한 계좌에서 후원금이 출금됩니다. 동의는
          마이페이지의 등록 계좌 관리에서 언제든 해지할 수 있습니다.
        </Notice>
      </div>
    </PublicShell>
  );
}
