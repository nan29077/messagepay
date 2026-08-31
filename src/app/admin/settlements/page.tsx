import Link from 'next/link';
import { PageHeader } from '@/components/layout/console-shell';
import { EmptyState, Notice, SectionTitle, StatTile, Table, Td, Th } from '@/components/ui';
import { AdminField, AdminInput, AdminSelect, CreatorOptions, FilterBar, Pager } from '@/components/admin/controls';
import { PAGE_SIZE, parsePage } from '@/components/admin/constants';
import { SettlementRequestsPanel, type SettlementRow } from '@/components/admin/settlement-requests';
import { prisma } from '@/server/db';
import { getSettlementSummary } from '@/server/services/settlement';
import { formatWon, formatNumber } from '@/lib/money';
import { formatKst, kstMonthKey } from '@/lib/datetime';
import { settlementStatusLabel, ledgerEntryLabel } from '@/lib/labels';
import type { Prisma } from '@/generated/prisma/client';
import type { SettlementRequestStatus } from '@/generated/prisma/enums';

export const dynamic = 'force-dynamic';

const REQUEST_STATUSES: SettlementRequestStatus[] = ['REQUESTED', 'REVIEWING', 'APPROVED', 'PAID', 'PAYOUT_FAILED', 'REJECTED'];

export default async function AdminSettlementsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; creatorId?: string; key?: string; page?: string; rpage?: string }>;
}) {
  const sp = await searchParams;
  const page = parsePage(sp.page);
  // 요청 목록과 원장 목록은 페이지를 따로 넘긴다 (하나의 page 로 묶으면 요청 목록이 2페이지부터 같은 내용을 반복한다)
  const requestPage = parsePage(sp.rpage);
  const status = REQUEST_STATUSES.includes(sp.status as SettlementRequestStatus)
    ? (sp.status as SettlementRequestStatus)
    : undefined;
  const creatorId = (sp.creatorId ?? '').trim() || undefined;
  const settlementKey = (sp.key ?? '').trim();

  const requestWhere: Prisma.SettlementRequestWhereInput = {
    ...(status ? { status } : {}),
    ...(creatorId ? { creatorId } : {}),
  };
  const ledgerWhere: Prisma.SettlementLedgerWhereInput = {
    ...(creatorId ? { creatorId } : {}),
    ...(settlementKey ? { settlementKey } : {}),
  };

  const [creators, requestTotal, requests, ledgerTotal, ledgers, byStatus, ledgerKeys] = await Promise.all([
    prisma.creatorProfile.findMany({
      where: { status: 'APPROVED' },
      orderBy: { displayName: 'asc' },
      take: 60,
      select: { id: true, displayName: true, code: true },
    }),
    prisma.settlementRequest.count({ where: requestWhere }),
    prisma.settlementRequest.findMany({
      where: requestWhere,
      // 미처리(REQUESTED→REVIEWING→APPROVED) 건을 먼저, 그 안에서는 오래된 순으로 본다.
      // 최신순으로만 정렬하면 오래 밀린 요청이 뒤로 밀려 영영 처리되지 않는다.
      orderBy: [{ status: 'asc' }, { requestedAt: 'asc' }],
      skip: (requestPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, amount: true, withholding: true, payoutAmount: true, status: true,
        memo: true, adminMemo: true, payoutFailReason: true,
        residentMasked: true, residentPurgedAt: true,
        requestedAt: true, approvedAt: true, paidAt: true, rejectedAt: true,
        creator: {
          select: {
            id: true, displayName: true, code: true,
            settlementAccount: { select: { bankName: true, accountTail4: true, holderMasked: true, verified: true } },
          },
        },
      },
    }),
    prisma.settlementLedger.count({ where: ledgerWhere }),
    prisma.settlementLedger.findMany({
      where: ledgerWhere,
      orderBy: { occurredAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, entryType: true, amount: true, memo: true, occurredAt: true, settlementKey: true,
        donationId: true, refundId: true, requestId: true,
        creator: { select: { id: true, displayName: true } },
      },
    }),
    prisma.settlementRequest.groupBy({ by: ['status'], _count: { _all: true }, _sum: { amount: true } }),
    prisma.settlementLedger.findMany({
      distinct: ['settlementKey'],
      orderBy: { settlementKey: 'desc' },
      take: 24,
      select: { settlementKey: true },
    }),
  ]);

  const summaries = await Promise.all(
    creators.slice(0, 30).map(async (c) => ({ creator: c, summary: await getSettlementSummary(c.id) })),
  );
  const visibleSummaries = summaries.filter((s) => s.summary.balance !== 0n || s.summary.pending !== 0n);

  const lastPage = Math.max(1, Math.ceil(ledgerTotal / PAGE_SIZE));
  const requestLastPage = Math.max(1, Math.ceil(requestTotal / PAGE_SIZE));

  // 클라이언트 패널로 넘길 직렬화 행 (BigInt·Date 를 문자열로)
  const requestRows: SettlementRow[] = requests.map((r) => ({
    id: r.id,
    requestedAt: formatKst(r.requestedAt, false),
    status: r.status,
    statusText: settlementStatusLabel[r.status].text,
    statusTone: settlementStatusLabel[r.status].tone,
    amount: r.amount.toString(),
    withholding: r.withholding.toString(),
    payoutAmount: r.payoutAmount.toString(),
    creatorName: r.creator.displayName,
    creatorCode: r.creator.code,
    bank: r.creator.settlementAccount?.bankName ?? null,
    accountTail4: r.creator.settlementAccount?.accountTail4 ?? null,
    holderMasked: r.creator.settlementAccount?.holderMasked ?? null,
    verified: r.creator.settlementAccount?.verified ?? false,
    adminMemo: r.adminMemo,
    memo: r.memo,
    residentMasked: r.residentMasked,
    residentPurged: Boolean(r.residentPurgedAt),
    paidAt: r.paidAt ? formatKst(r.paidAt, false) : null,
    failReason: r.payoutFailReason,
  }));
  const countOf = (s: SettlementRequestStatus) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
  const sumOf = (s: SettlementRequestStatus) => byStatus.find((b) => b.status === s)?._sum.amount ?? 0n;

  return (
    <>
      <PageHeader
        title="정산 관리"
        description="가맹점별 정산 잔액과 정산 요청 처리, 정산 원장 조회를 제공합니다."
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatTile label="요청 대기" value={formatNumber(countOf('REQUESTED'))} sub={formatWon(sumOf('REQUESTED'))} tone={countOf('REQUESTED') > 0 ? 'warning' : 'neutral'} />
        <StatTile label="검토중" value={formatNumber(countOf('REVIEWING'))} sub={formatWon(sumOf('REVIEWING'))} />
        <StatTile label="승인(지급 대기)" value={formatNumber(countOf('APPROVED'))} sub={formatWon(sumOf('APPROVED'))} tone="brand" />
        <StatTile label="지급 완료" value={formatNumber(countOf('PAID'))} sub={formatWon(sumOf('PAID'))} tone="success" />
      </div>

      <Notice tone="danger" title="정산 원장은 조회 전용입니다">
        settlement_ledger 는 append-only 테이블이며, UPDATE/DELETE 는 DB 트리거로 차단되어 있습니다. 금액 정정이
        필요하면 반대 부호의 조정(ADJUSTMENT) 분개를 추가해야 합니다. 이 화면에서 원장을 직접 수정할 수 없습니다.
      </Notice>

      <section className="mt-5">
        <SectionTitle
          title="가맹점별 정산 요약"
          description="잔액 = 원장 합계 / 보류 = 정산 요청 중 금액 / 가능 = 지금 요청 가능한 금액"
        />
        {visibleSummaries.length === 0 ? (
          <EmptyState title="정산 원장이 있는 가맹점이 없습니다" />
        ) : (
          <Table className="min-w-[1000px]">
            <thead>
              <tr>
                <Th>가맹점</Th>
                <Th className="text-right">결제 총액</Th>
                <Th className="text-right">수수료</Th>
                <Th className="text-right">환불</Th>
                <Th className="text-right">지급 완료</Th>
                <Th className="text-right">잔액</Th>
                <Th className="text-right">보류</Th>
                <Th className="text-right">정산 가능</Th>
              </tr>
            </thead>
            <tbody>
              {visibleSummaries.map(({ creator, summary }) => (
                <tr key={creator.id}>
                  <Td>
                    <Link href={`/admin/creators/${creator.id}`} className="font-semibold text-brand-700">
                      {creator.displayName}
                    </Link>
                    <span className="mt-0.5 block text-[11px] text-ink-400">{creator.code}</span>
                  </Td>
                  <Td className="text-right tabular-nums">{formatWon(summary.totalGross)}</Td>
                  <Td className="text-right tabular-nums">{formatWon(summary.totalPgFee + summary.totalPlatformFee)}</Td>
                  <Td className="text-right tabular-nums">{formatWon(summary.totalRefund)}</Td>
                  <Td className="text-right tabular-nums">{formatWon(summary.totalPaid)}</Td>
                  <Td className="text-right font-semibold tabular-nums">{formatWon(summary.balance)}</Td>
                  <Td className="text-right tabular-nums">{formatWon(summary.pending)}</Td>
                  <Td className="text-right font-semibold tabular-nums text-brand-700">{formatWon(summary.available)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section className="mt-6">
        <SectionTitle
          title="정산 요청 처리"
          description={`전체 ${formatNumber(requestTotal)}건 · 미처리 건을 오래된 순으로 먼저 보여줍니다 (${requestPage}/${requestLastPage} 페이지)`}
        />
        <FilterBar action="/admin/settlements" resetHref="/admin/settlements">
          <AdminField label="요청 상태" className="w-40">
            <AdminSelect name="status" defaultValue={status ?? ''}>
              <option value="">전체</option>
              {REQUEST_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {settlementStatusLabel[s].text}
                </option>
              ))}
            </AdminSelect>
          </AdminField>
          <AdminField label="가맹점" className="w-52">
            <AdminSelect name="creatorId" defaultValue={creatorId ?? ''}>
              <CreatorOptions creators={creators} />
            </AdminSelect>
          </AdminField>
          <AdminField label="정산 월 (원장 필터)" className="w-40">
            <AdminInput name="key" defaultValue={settlementKey} placeholder={kstMonthKey()} list="settlement-keys" />
          </AdminField>
          <datalist id="settlement-keys">
            {ledgerKeys.map((k) => (
              <option key={k.settlementKey} value={k.settlementKey} />
            ))}
          </datalist>
        </FilterBar>

        <SettlementRequestsPanel rows={requestRows} />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Link 는 화면에 보이면 prefetch 로 GET 을 미리 호출해 주민번호 복호화·감사로그가 클릭 없이 쌓인다. */}
          <a
            href={`/api/admin/settlements/withholding?from=${kstMonthKey()}-01`}
            className="rounded-lg border border-ink-200 px-3 py-1.5 text-[12px] font-bold text-ink-700 hover:bg-ink-50"
          >
            이번 달 원천징수 지급명세서 자료 받기
          </a>
          <span className="text-[11.5px] text-ink-400">지급 완료 건의 지급명세서 산출 자료(CSV)를 내려받습니다.</span>
        </div>

        <Pager
          basePath="/admin/settlements"
          params={{ status: status ?? '', creatorId: creatorId ?? '', key: settlementKey, page: String(page) }}
          page={requestPage}
          lastPage={requestLastPage}
          total={requestTotal}
          pageParam="rpage"
        />
      </section>

      <section className="mt-6">
        <SectionTitle
          title="정산 원장 조회"
          description="가맹점과 정산 월(settlement_key)로 필터링할 수 있습니다. 조회 전용입니다."
        />
        {ledgers.length === 0 ? (
          <EmptyState title="조건에 맞는 원장 분개가 없습니다" />
        ) : (
          <>
            <Table className="min-w-[1000px]">
              <thead>
                <tr>
                  <Th>발생 시각</Th>
                  <Th>정산 월</Th>
                  <Th>가맹점</Th>
                  <Th>분개 유형</Th>
                  <Th className="text-right">금액</Th>
                  <Th>메모</Th>
                  <Th>연결 ID</Th>
                </tr>
              </thead>
              <tbody>
                {ledgers.map((l) => (
                  <tr key={l.id}>
                    <Td className="whitespace-nowrap">{formatKst(l.occurredAt, false)}</Td>
                    <Td className="font-mono text-[12px]">{l.settlementKey}</Td>
                    <Td>
                      <Link href={`/admin/creators/${l.creator.id}`} className="font-semibold text-brand-700">
                        {l.creator.displayName}
                      </Link>
                    </Td>
                    <Td>{ledgerEntryLabel[l.entryType]}</Td>
                    <Td className={`text-right tabular-nums ${l.amount < 0n ? 'text-danger-500' : 'text-success-500'}`}>
                      {formatWon(l.amount)}
                    </Td>
                    <Td className="max-w-[200px] break-words">{l.memo ?? '-'}</Td>
                    <Td className="font-mono text-[11px] text-ink-400">
                      {l.donationId ? <span className="block">결제 {l.donationId}</span> : null}
                      {l.refundId ? <span className="block">환불 {l.refundId}</span> : null}
                      {l.requestId ? <span className="block">정산 {l.requestId}</span> : null}
                      {!l.donationId && !l.refundId && !l.requestId ? '-' : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager
              basePath="/admin/settlements"
              params={{ status: status ?? '', creatorId: creatorId ?? '', key: settlementKey, rpage: String(requestPage) }}
              page={page}
              lastPage={lastPage}
              total={ledgerTotal}
            />
          </>
        )}
      </section>
    </>
  );
}
