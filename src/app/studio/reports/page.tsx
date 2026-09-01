import Link from 'next/link';
import { Badge, EmptyState, Notice, SectionTitle, StatTile, Table, Td, Th } from '@/components/ui';
import { PageHeader } from '@/components/layout/console-shell';
import { requireMerchant } from '@/server/auth';
import { prisma } from '@/server/db';
import { formatNumber } from '@/lib/money';
import { formatKst } from '@/lib/datetime';
import type { ReportStatus } from '@/generated/prisma/enums';

export const dynamic = 'force-dynamic';

const REPORT_STATUS: Record<ReportStatus, { text: string; tone: 'neutral' | 'brand' | 'success' | 'warning' }> = {
  OPEN: { text: '접수', tone: 'warning' },
  REVIEWING: { text: '검토중', tone: 'brand' },
  RESOLVED: { text: '처리완료', tone: 'success' },
  DISMISSED: { text: '반려', tone: 'neutral' },
};

export default async function StudioReportsPage() {
  const { merchantId } = await requireMerchant();

  const reports = await prisma.report.findMany({
    where: { merchantId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const chargeIds = reports.map((r) => r.chargeId).filter((v): v is string => Boolean(v));
  const charges = chargeIds.length
    ? await prisma.charge.findMany({
        where: { id: { in: chargeIds }, merchantId },
        select: { id: true, transactionNo: true },
      })
    : [];
  const chargeMap = new Map(charges.map((d) => [d.id, d.transactionNo]));

  const counts = {
    OPEN: reports.filter((r) => r.status === 'OPEN').length,
    REVIEWING: reports.filter((r) => r.status === 'REVIEWING').length,
    RESOLVED: reports.filter((r) => r.status === 'RESOLVED').length,
    DISMISSED: reports.filter((r) => r.status === 'DISMISSED').length,
  };

  return (
    <>
      <PageHeader title="신고 내역" description="내 채널과 관련해 접수된 신고입니다. 최근 100건을 표시합니다." />

      <div className="space-y-5">
        <Notice tone="neutral" title="신고는 통합 관리자가 처리합니다">
          가맹점은 신고 내용을 확인만 할 수 있고 상태를 직접 변경할 수 없습니다. 조치가 필요한 이용자는
          금칙어·차단 메뉴에서 직접 차단할 수 있습니다. 신고자 정보는 개인정보 보호를 위해 표시되지 않습니다.
        </Notice>

        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <StatTile label="접수" value={`${formatNumber(counts.OPEN)}건`} tone="warning" />
          <StatTile label="검토중" value={`${formatNumber(counts.REVIEWING)}건`} tone="brand" />
          <StatTile label="처리완료" value={`${formatNumber(counts.RESOLVED)}건`} tone="success" />
          <StatTile label="반려" value={`${formatNumber(counts.DISMISSED)}건`} />
        </div>

        <section>
          <SectionTitle title="신고 목록" />
          {reports.length === 0 ? (
            <EmptyState title="접수된 신고가 없습니다" description="이용자 신고가 들어오면 여기에 표시됩니다." />
          ) : (
            <Table className="min-w-full">
              <thead>
                <tr>
                  <Th>접수일</Th>
                  <Th>분류</Th>
                  <Th>내용</Th>
                  <Th>관련 거래</Th>
                  <Th>상태</Th>
                  <Th>처리일</Th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => {
                  const st = REPORT_STATUS[r.status];
                  const txNo = r.chargeId ? chargeMap.get(r.chargeId) : null;
                  return (
                    <tr key={r.id}>
                      <Td className="whitespace-nowrap tabular-nums">{formatKst(r.createdAt, false)}</Td>
                      <Td className="whitespace-nowrap">{r.category}</Td>
                      <Td className="max-w-[360px]">
                        <span className="line-clamp-3">{r.content}</span>
                      </Td>
                      <Td>
                        {r.chargeId && txNo ? (
                          <Link
                            href={`/studio/charges/${r.chargeId}`}
                            className="font-mono text-[12px] font-semibold text-brand-700 underline-offset-2 hover:underline"
                          >
                            {txNo}
                          </Link>
                        ) : (
                          <span className="text-ink-300">-</span>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={st.tone}>{st.text}</Badge>
                      </Td>
                      <Td className="whitespace-nowrap tabular-nums">{formatKst(r.handledAt, false)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </section>
      </div>
    </>
  );
}
