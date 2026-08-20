import Link from 'next/link';
import { PageHeader } from '@/components/layout/console-shell';
import { Badge, EmptyState, Notice, SectionTitle, StatTile, Table, Td, Th } from '@/components/ui';
import { AdminField, AdminSelect, FilterBar, Pager } from '@/components/admin/controls';
import { PAGE_SIZE, parsePage } from '@/components/admin/constants';
import { prisma } from '@/server/db';
import { formatNumber } from '@/lib/money';
import { formatKst } from '@/lib/datetime';
import type { Prisma } from '@/generated/prisma/client';
import type { InquiryStatus } from '@/generated/prisma/enums';
import { requireAdmin } from '@/server/auth';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<InquiryStatus, { text: string; tone: 'warning' | 'success' | 'neutral' }> = {
  OPEN: { text: '답변 대기', tone: 'warning' },
  ANSWERED: { text: '답변 완료', tone: 'success' },
  CLOSED: { text: '종결', tone: 'neutral' },
};

export default async function AdminInquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const admin = await requireAdmin();
  if (admin.adminPermission !== 'SUPER_ADMIN') redirect('/admin');
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const status = (['OPEN', 'ANSWERED', 'CLOSED'] as const).includes(sp.status as InquiryStatus)
    ? (sp.status as InquiryStatus)
    : undefined;

  const where: Prisma.SupportInquiryWhereInput = status ? { status } : {};

  const [total, inquiries, byStatus, unreadCount] = await Promise.all([
    prisma.supportInquiry.count({ where }),
    prisma.supportInquiry.findMany({
      where,
      orderBy: [{ status: 'asc' }, { lastMessageAt: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, userId: true, guestName: true, contactMasked: true, category: true, status: true,
        createdAt: true, lastMessageAt: true,
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { sender: true, body: true } },
        _count: { select: { messages: true } },
      },
    }),
    prisma.supportInquiry.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.supportMessage.count({ where: { sender: 'USER', readByAdminAt: null } }),
  ]);

  const userIds = inquiries.map((i) => i.userId).filter((v): v is string => Boolean(v));
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true, role: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const count = (s: InquiryStatus) => byStatus.find((b) => b.status === s)?._count._all ?? 0;

  return (
    <>
      <PageHeader
        title="문의 관리"
        description="사이트 우측 하단 문의 버튼으로 접수된 1:1 채팅 문의입니다. 답변을 등록하면 사용자 문의 창에 바로 표시됩니다."
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatTile label="답변 대기" value={formatNumber(count('OPEN'))} tone={count('OPEN') > 0 ? 'warning' : 'neutral'} />
        <StatTile label="답변 완료" value={formatNumber(count('ANSWERED'))} tone="success" />
        <StatTile label="종결" value={formatNumber(count('CLOSED'))} />
        <StatTile label="읽지 않은 메시지" value={formatNumber(unreadCount)} tone={unreadCount > 0 ? 'brand' : 'neutral'} />
      </div>

      {count('OPEN') > 0 ? (
        <Notice tone="warning" title={`답변을 기다리는 문의가 ${formatNumber(count('OPEN'))}건 있습니다`}>
          답변 대기 문의가 목록 맨 위에 표시됩니다. 문의 제목을 눌러 답변을 등록해 주세요.
        </Notice>
      ) : (
        <Notice tone="success">답변을 기다리는 문의가 없습니다.</Notice>
      )}

      <div className="mt-5">
        <SectionTitle title="문의 목록" />
        <FilterBar action="/admin/inquiries" resetHref="/admin/inquiries">
          <AdminField label="상태" className="w-40">
            <AdminSelect name="status" defaultValue={status ?? ''}>
              <option value="">전체</option>
              <option value="OPEN">답변 대기</option>
              <option value="ANSWERED">답변 완료</option>
              <option value="CLOSED">종결</option>
            </AdminSelect>
          </AdminField>
        </FilterBar>
      </div>

      {inquiries.length === 0 ? (
        <EmptyState title="문의가 없습니다" description="사용자가 문의를 보내면 이곳에 표시됩니다." />
      ) : (
        <>
          <Table className="min-w-[980px]">
            <thead>
              <tr>
                <Th>문의자</Th>
                <Th>최근 메시지</Th>
                <Th className="text-right">메시지 수</Th>
                <Th>상태</Th>
                <Th>최근 활동</Th>
                <Th>접수일</Th>
              </tr>
            </thead>
            <tbody>
              {inquiries.map((q) => {
                const u = q.userId ? userMap.get(q.userId) : null;
                const label = STATUS_LABEL[q.status];
                const last = q.messages[0];
                return (
                  <tr key={q.id}>
                    <Td>
                      <Link href={`/admin/inquiries/${q.id}`} className="font-semibold text-brand-700">
                        {u ? (u.name ?? u.email ?? '회원') : (q.guestName || '비회원')}
                      </Link>
                      <span className="mt-0.5 block text-[11px] text-ink-400">
                        [{q.category}] {u ? `${u.email ?? '-'} · ${u.role}` : `게스트${q.contactMasked ? ` · ${q.contactMasked}` : ''}`}
                      </span>
                    </Td>
                    <Td>
                      <span className="block max-w-[360px] truncate text-[12.5px] text-ink-700">
                        {last ? `${last.sender === 'ADMIN' ? '[답변] ' : ''}${last.body}` : '-'}
                      </span>
                    </Td>
                    <Td className="text-right tabular-nums">{formatNumber(q._count.messages)}</Td>
                    <Td>
                      <Badge tone={label.tone}>{label.text}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums">{formatKst(q.lastMessageAt, false)}</Td>
                    <Td className="whitespace-nowrap tabular-nums">{formatKst(q.createdAt, false)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <Pager basePath="/admin/inquiries" params={{ status: status ?? '' }} page={page} lastPage={lastPage} total={total} />
        </>
      )}
    </>
  );
}
