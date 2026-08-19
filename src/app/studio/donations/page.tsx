import Link from 'next/link';
import { Search } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Field, Input, Select, Table, Td, Th } from '@/components/ui';
import { PageHeader } from '@/components/layout/console-shell';
import { buildQuery, one, type SearchParamsRecord } from '@/components/studio/shared';
import { requireCreator } from '@/server/auth';
import { prisma } from '@/server/db';
import { formatNumber, formatWon } from '@/lib/money';
import { formatKst, kstStartOfDay } from '@/lib/datetime';
import { deliveryStatusLabel, donationStatusLabel, refundStatusLabel } from '@/lib/labels';
import type { DonationStatus, Prisma } from '@/generated/prisma/client';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

const PERIODS = [
  { value: 'today', label: '오늘' },
  { value: '7d', label: '최근 7일' },
  { value: '30d', label: '최근 30일' },
  { value: 'all', label: '전체' },
] as const;

const STATUS_VALUES = Object.keys(donationStatusLabel) as DonationStatus[];

function periodStart(period: string): Date | null {
  const now = new Date();
  if (period === 'today') return kstStartOfDay(now);
  if (period === '7d') return new Date(now.getTime() - 7 * 86_400_000);
  if (period === '30d') return new Date(now.getTime() - 30 * 86_400_000);
  return null;
}

export default async function StudioDonationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  const { creatorId } = await requireCreator();
  const sp = await searchParams;

  const period = one(sp.period) || '30d';
  const status = one(sp.status);
  const q = one(sp.q).trim();
  const page = Math.max(1, Number(one(sp.page)) || 1);

  const where: Prisma.DonationWhereInput = { creatorId };
  const gte = periodStart(period);
  if (gte) where.receivedAt = { gte };
  if (status && (STATUS_VALUES as string[]).includes(status)) where.status = status as DonationStatus;
  if (q) where.transactionNo = { contains: q, mode: 'insensitive' };

  const [total, rows] = await Promise.all([
    prisma.donation.count({ where }),
    prisma.donation.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        transactionNo: true,
        receivedAt: true,
        displayName: true,
        anonymous: true,
        message: true,
        amount: true,
        status: true,
        youtubeStatus: true,
        overlayStatus: true,
        mtStatus: true,
        donor: { select: { phoneMasked: true } },
        refunds: { orderBy: { requestedAt: 'desc' }, take: 1, select: { status: true } },
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const base = { period, status, q };

  return (
    <>
      <PageHeader
        title="후원 내역"
        description={`조건에 해당하는 후원 ${formatNumber(total)}건 (${page}/${totalPages} 페이지)`}
      />

      <div className="space-y-4">
        <Card>
          <form method="get" className="grid gap-3 md:grid-cols-[1fr_1fr_2fr_auto] md:items-end">
            <Field label="기간">
              <Select name="period" defaultValue={period}>
                {PERIODS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="상태">
              <Select name="status" defaultValue={status}>
                <option value="">전체 상태</option>
                {STATUS_VALUES.map((s) => (
                  <option key={s} value={s}>
                    {donationStatusLabel[s].text}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="거래번호 검색">
              <Input name="q" defaultValue={q} placeholder="TRD-20260819-XXXXXXXX" />
            </Field>
            <Button type="submit" variant="secondary">
              <Search size={16} strokeWidth={1.7} />
              조회
            </Button>
          </form>
        </Card>

        {rows.length === 0 ? (
          <EmptyState title="조건에 맞는 후원 내역이 없습니다" description="기간이나 상태 조건을 바꿔서 다시 조회해 보세요." />
        ) : (
          <Table className="min-w-full">
            <thead>
              <tr>
                <Th>거래번호</Th>
                <Th>수신시각</Th>
                <Th>후원자</Th>
                <Th>표시명</Th>
                <Th>문자 내용</Th>
                <Th className="text-right">후원금</Th>
                <Th>결제 상태</Th>
                <Th>유튜브</Th>
                <Th>오버레이</Th>
                <Th>MT 안내</Th>
                <Th>환불</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const st = donationStatusLabel[d.status];
                const yt = deliveryStatusLabel[d.youtubeStatus];
                const ov = deliveryStatusLabel[d.overlayStatus];
                const mt = deliveryStatusLabel[d.mtStatus];
                const refund = d.refunds[0] ? refundStatusLabel[d.refunds[0].status] : null;
                return (
                  <tr key={d.id} className="hover:bg-ink-50">
                    <Td>
                      <Link
                        href={`/studio/donations/${d.id}`}
                        className="font-mono text-[12px] font-semibold text-brand-600 underline-offset-2 hover:underline"
                      >
                        {d.transactionNo}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums">{formatKst(d.receivedAt, false)}</Td>
                    <Td className="whitespace-nowrap tabular-nums">{d.donor?.phoneMasked ?? '-'}</Td>
                    <Td className="whitespace-nowrap">{d.anonymous ? '익명의 후원자' : d.displayName}</Td>
                    <Td className="max-w-[280px]">
                      <span className="line-clamp-2">{d.message || '-'}</span>
                    </Td>
                    <Td className="whitespace-nowrap text-right font-semibold tabular-nums text-ink-900">
                      {formatWon(d.amount)}
                    </Td>
                    <Td>
                      <Badge tone={st.tone}>{st.text}</Badge>
                    </Td>
                    <Td>
                      <Badge tone={yt.tone}>{yt.text}</Badge>
                    </Td>
                    <Td>
                      <Badge tone={ov.tone}>{ov.text}</Badge>
                    </Td>
                    <Td>
                      <Badge tone={mt.tone}>{mt.text}</Badge>
                    </Td>
                    <Td>{refund ? <Badge tone={refund.tone}>{refund.text}</Badge> : <span className="text-ink-300">-</span>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}

        {totalPages > 1 ? (
          <nav className="flex items-center justify-center gap-2">
            <PageLink href={`/studio/donations${buildQuery(base, { page: page - 1 })}`} disabled={page <= 1}>
              이전
            </PageLink>
            <span className="text-[13px] tabular-nums text-ink-500">
              {page} / {totalPages}
            </span>
            <PageLink href={`/studio/donations${buildQuery(base, { page: page + 1 })}`} disabled={page >= totalPages}>
              다음
            </PageLink>
          </nav>
        ) : null}
      </div>
    </>
  );
}

function PageLink({ href, disabled, children }: { href: string; disabled: boolean; children: React.ReactNode }) {
  if (disabled) {
    return (
      <span className="inline-flex h-9 items-center rounded-lg border border-ink-100 px-3 text-[13px] font-semibold text-ink-300">
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="inline-flex h-9 items-center rounded-lg border border-ink-200 bg-white px-3 text-[13px] font-semibold text-ink-700 hover:bg-ink-50"
    >
      {children}
    </Link>
  );
}
