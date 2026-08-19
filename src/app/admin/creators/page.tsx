import Link from 'next/link';
import { PageHeader } from '@/components/layout/console-shell';
import { Badge, EmptyState, Notice, SectionTitle, StatTile, Table, Td, Th } from '@/components/ui';
import { AdminField, AdminInput, AdminSelect, FilterBar, Pager } from '@/components/admin/controls';
import { SelectActionForm } from '@/components/admin/action-form';
import { PAGE_SIZE, parsePage } from '@/components/admin/constants';
import { updateCreatorStatus } from '@/app/actions/admin/accounts';
import { prisma } from '@/server/db';
import { formatWon, formatNumber } from '@/lib/money';
import { formatKst } from '@/lib/datetime';
import { creatorStatusLabel } from '@/lib/labels';
import type { Prisma } from '@/generated/prisma/client';
import type { CreatorStatus } from '@/generated/prisma/enums';

export const dynamic = 'force-dynamic';

const STATUS_OPTIONS: Array<{ value: CreatorStatus; label: string }> = [
  { value: 'PENDING', label: '심사대기' },
  { value: 'APPROVED', label: '승인' },
  { value: 'REJECTED', label: '반려' },
  { value: 'SUSPENDED', label: '정지' },
];

const creatorSelect = {
  id: true,
  displayName: true,
  channelName: true,
  code: true,
  status: true,
  donationAmount: true,
  businessNo: true,
  approvedAt: true,
  createdAt: true,
  user: { select: { email: true, name: true, phoneMasked: true } },
  moRoutes: { where: { status: 'ASSIGNED' as const }, select: { phoneNumber: true, keyword: true } },
  _count: { select: { donations: true } },
} satisfies Prisma.CreatorProfileSelect;

function CreatorRows({
  creators,
}: {
  creators: Array<{
    id: string;
    displayName: string;
    channelName: string | null;
    code: string;
    status: CreatorStatus;
    donationAmount: bigint;
    businessNo: string | null;
    approvedAt: Date | null;
    createdAt: Date;
    user: { email: string | null; name: string | null; phoneMasked: string | null };
    moRoutes: Array<{ phoneNumber: string; keyword: string | null }>;
    _count: { donations: number };
  }>;
}) {
  return (
    <tbody>
      {creators.map((c) => (
        <tr key={c.id}>
          <Td>
            <Link href={`/admin/creators/${c.id}`} className="font-semibold text-brand-600">
              {c.displayName}
            </Link>
            <span className="mt-0.5 block text-[11px] text-ink-400">{c.channelName ?? '채널명 미등록'}</span>
          </Td>
          <Td className="font-mono text-[12px]">{c.code}</Td>
          <Td>
            {c.user.email ?? '-'}
            <span className="mt-0.5 block text-[11px] text-ink-400">{c.user.phoneMasked ?? '연락처 미등록'}</span>
          </Td>
          <Td className="text-right tabular-nums">{formatWon(c.donationAmount)}</Td>
          <Td>
            {c.moRoutes.length === 0 ? (
              <Badge tone="warning">미배정</Badge>
            ) : (
              c.moRoutes.map((m) => (
                <span key={`${m.phoneNumber}-${m.keyword ?? ''}`} className="block text-[12px]">
                  {m.phoneNumber}
                  {m.keyword ? ` (${m.keyword})` : ''}
                </span>
              ))
            )}
          </Td>
          <Td className="text-right tabular-nums">{formatNumber(c._count.donations)}</Td>
          <Td>
            <Badge tone={creatorStatusLabel[c.status].tone}>{creatorStatusLabel[c.status].text}</Badge>
            <span className="mt-0.5 block text-[11px] text-ink-400">
              신청 {formatKst(c.createdAt, false)}
              {c.approvedAt ? ` · 승인 ${formatKst(c.approvedAt, false)}` : ''}
            </span>
          </Td>
          <Td>
            <SelectActionForm
              action={updateCreatorStatus}
              values={{ creatorId: c.id }}
              name="status"
              defaultValue={c.status}
              options={STATUS_OPTIONS}
              confirm={`${c.displayName} 님의 심사 상태를 변경합니다.`}
              hint={c.status === 'PENDING' ? '승인 후 MO 번호 배정이 필요합니다.' : undefined}
            />
          </Td>
        </tr>
      ))}
    </tbody>
  );
}

const HEAD = (
  <thead>
    <tr>
      <Th>크리에이터</Th>
      <Th>코드</Th>
      <Th>담당자</Th>
      <Th className="text-right">1건 후원금</Th>
      <Th>MO 번호</Th>
      <Th className="text-right">후원 건수</Th>
      <Th>상태</Th>
      <Th>심사 처리</Th>
    </tr>
  </thead>
);

export default async function AdminCreatorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const q = (sp.q ?? '').trim();
  const status = STATUS_OPTIONS.some((s) => s.value === sp.status) ? (sp.status as CreatorStatus) : undefined;

  const where: Prisma.CreatorProfileWhereInput = {
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { displayName: { contains: q, mode: 'insensitive' as const } },
            { channelName: { contains: q, mode: 'insensitive' as const } },
            { code: { contains: q.toUpperCase() } },
            { user: { email: { contains: q, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };

  const [pending, total, creators, byStatus] = await Promise.all([
    prisma.creatorProfile.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: creatorSelect,
    }),
    prisma.creatorProfile.count({ where }),
    prisma.creatorProfile.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: creatorSelect,
    }),
    prisma.creatorProfile.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const count = (s: CreatorStatus) => byStatus.find((b) => b.status === s)?._count._all ?? 0;

  return (
    <>
      <PageHeader
        title="크리에이터 심사"
        description="심사 대기 건을 먼저 처리하고, 승인 후에는 MO 번호를 배정해야 문자후원이 접수됩니다."
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatTile label="심사대기" value={formatNumber(count('PENDING'))} tone={count('PENDING') > 0 ? 'warning' : 'neutral'} />
        <StatTile label="승인" value={formatNumber(count('APPROVED'))} tone="success" />
        <StatTile label="반려" value={formatNumber(count('REJECTED'))} />
        <StatTile label="정지" value={formatNumber(count('SUSPENDED'))} tone={count('SUSPENDED') > 0 ? 'danger' : 'neutral'} />
      </div>

      {pending.length > 0 ? (
        <section className="mb-6">
          <SectionTitle
            title={`심사 대기 ${pending.length}건`}
            description="신청 순서대로 표시합니다. 승인 시 승인 시각이 기록되고 감사로그가 남습니다."
          />
          <Notice tone="warning" title="승인 전 확인 사항">
            채널 실명 확인, 사업자 정보, 정산 계좌 인증 여부를 함께 검토해 주세요. 승인 후 MO 번호 배정 화면에서 수신
            번호를 지정해야 후원 문자가 라우팅됩니다.
          </Notice>
          <div className="mt-3">
            <Table className="min-w-[1100px]">
              {HEAD}
              <CreatorRows creators={pending} />
            </Table>
          </div>
        </section>
      ) : (
        <Notice tone="success" title="심사 대기 건이 없습니다">
          새 신청이 들어오면 이 위치에 우선 표시됩니다.
        </Notice>
      )}

      <SectionTitle title="전체 크리에이터" />

      <FilterBar action="/admin/creators" resetHref="/admin/creators">
        <AdminField label="검색 (이름/채널/코드/이메일)" className="w-64">
          <AdminInput name="q" defaultValue={q} placeholder="토네이도 또는 TOR-8K2M" />
        </AdminField>
        <AdminField label="상태" className="w-36">
          <AdminSelect name="status" defaultValue={status ?? ''}>
            <option value="">전체</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </AdminSelect>
        </AdminField>
      </FilterBar>

      {creators.length === 0 ? (
        <EmptyState title="조건에 맞는 크리에이터가 없습니다" />
      ) : (
        <>
          <Table className="min-w-[1100px]">
            {HEAD}
            <CreatorRows creators={creators} />
          </Table>
          <Pager
            basePath="/admin/creators"
            params={{ q, status: status ?? '' }}
            page={page}
            lastPage={lastPage}
            total={total}
          />
        </>
      )}
    </>
  );
}
