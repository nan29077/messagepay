import type { Metadata } from 'next';
import { PublicShell } from '@/components/layout/public-shell';
import { PageHeader } from '@/components/public/page-header';
import { TermsArticle, TermsNav } from '@/components/public/terms-article';
import { Notice } from '@/components/ui';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '개인정보처리방침 | 문자페이',
  description: '문자페이가 수집하는 개인정보 항목과 이용 목적, 보유 기간을 안내합니다.',
};

export default async function PrivacyPage() {
  const doc = await prisma.termsVersion.findFirst({
    where: { type: 'PRIVACY', active: true },
    orderBy: { effectiveFrom: 'desc' },
  });

  return (
    <PublicShell>
      <PageHeader
        eyebrow="개인정보"
        title="개인정보처리방침"
        description="수집 항목, 이용 목적, 보유 기간과 이용자의 권리를 안내합니다."
      />
      <TermsNav current="privacy" />
      <TermsArticle doc={doc} />
      <div className="mt-4">
        <Notice tone="brand" title="저장 원칙">
          휴대전화번호와 계좌 정보는 원문을 저장하지 않습니다. 검색용 해시와 암호문, 화면 표시용 마스킹 값만 분리해
          보관하며 화면에는 마스킹된 값만 표시됩니다.
        </Notice>
      </div>
    </PublicShell>
  );
}
