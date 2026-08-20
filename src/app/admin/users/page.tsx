import Link from 'next/link';
import { PageHeader } from '@/components/layout/console-shell';
import { Badge, EmptyState, Notice, StatTile, Table, Td, Th } from '@/components/ui';
import { AdminField, AdminInput, AdminSelect, FilterBar, Pager } from '@/components/admin/controls';
import { SelectActionForm } from '@/components/admin/action-form';
import { PAGE_SIZE, parsePage } from '@/components/admin/constants';
import { updateUserStatus } from '@/app/actions/admin/accounts';
import { prisma } from '@/server/db';
import { formatNumber } from '@/lib/money';
import { formatKst } from '@/lib/datetime';
import type { Prisma } from '@/generated/prisma/client';
import type { UserRole, UserStatus } from '@/generated/prisma/enums';
import { GeneratedAvatar } from '@/components/profile/generated-avatar';

export const dynamic = 'force-dynamic';

const roleLabel: Record<UserRole, string> = { DONOR: '후원자', CREATOR: '크리에이터', ADMIN: '관리자' };
const statusLabel: Record<UserStatus, { text: string; tone: 'success' | 'warning' | 'neutral' }> = {
  ACTIVE: { text: '활성', tone: 'success' },
  SUSPENDED: { text: '정지', tone: 'warning' },
  WITHDRAWN: { text: '탈퇴', tone: 'neutral' },
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; status?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const q = (sp.q ?? '').trim();
  const role = sp.role && sp.role in roleLabel ? (sp.role as UserRole) : undefined;
  const status = sp.status && sp.status in statusLabel ? (sp.status as UserStatus) : undefined;

  const where: Prisma.UserWhereInput = {
    ...(role ? { role } : {}),
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { email: { contains: q, mode: 'insensitive' as const } },
            { name: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [total, users, byStatus] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, email: true, name: true, role: true, status: true,
        phoneMasked: true, lastLoginAt: true, createdAt: true,
        creatorProfile: { select: { id: true, displayName: true, code: true } },
        donorProfile: { select: { id: true } },
        adminProfile: { select: { permission: true } },
      },
    }),
    prisma.user.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const count = (s: UserStatus) => byStatus.find((b) => b.status === s)?._count._all ?? 0;

  return (
    <>
      <PageHeader
        title="회원 관리"
        description="이메일·이름으로 검색하고 계정 상태를 변경합니다. 상태 변경 시 활성 세션이 즉시 만료됩니다."
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatTile label="전체 회원" value={formatNumber(byStatus.reduce((a, b) => a + b._count._all, 0))} />
        <StatTile label="활성" value={formatNumber(count('ACTIVE'))} tone="success" />
        <StatTile label="정지" value={formatNumber(count('SUSPENDED'))} tone="warning" />
        <StatTile label="탈퇴" value={formatNumber(count('WITHDRAWN'))} />
      </div>

      <FilterBar action="/admin/users" resetHref="/admin/users">
        <AdminField label="검색 (이메일/이름)" className="w-56">
          <AdminInput name="q" defaultValue={q} placeholder="example@tornado.kr" />
        </AdminField>
        <AdminField label="회원 유형" className="w-36">
          <AdminSelect name="role" defaultValue={role ?? ''}>
            <option value="">전체</option>
            {(Object.keys(roleLabel) as UserRole[]).map((r) => (
              <option key={r} value={r}>
                {roleLabel[r]}
              </option>
            ))}
          </AdminSelect>
        </AdminField>
        <AdminField label="상태" className="w-36">
          <AdminSelect name="status" defaultValue={status ?? ''}>
            <option value="">전체</option>
            {(Object.keys(statusLabel) as UserStatus[]).map((s) => (
              <option key={s} value={s}>
                {statusLabel[s].text}
              </option>
            ))}
          </AdminSelect>
        </AdminField>
      </FilterBar>

      <Notice tone="neutral" title="개인정보 표시 원칙">
        전화번호는 마스킹된 값만 표시합니다. 원문 전화번호·계좌번호는 관리자 화면에서도 조회할 수 없습니다.
      </Notice>

      <div className="mt-4">
        {users.length === 0 ? (
          <EmptyState title="조건에 맞는 회원이 없습니다" description="검색어나 필터를 조정해 보세요." />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>이메일</Th>
                  <Th>이름</Th>
                  <Th>유형</Th>
                  <Th>연락처</Th>
                  <Th>상태</Th>
                  <Th>최근 로그인</Th>
                  <Th>가입일</Th>
                  <Th>상태 변경</Th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <Td className="max-w-[220px] break-all">{u.email ?? '-'}</Td>
                    <Td>
                      <div className="flex min-w-[150px] items-center gap-2.5">
                        <GeneratedAvatar seed={u.id} name={u.name} className="h-9 w-9" />
                        <div className="min-w-0">
                      <span className="block truncate font-semibold text-ink-900">{u.name ?? '-'}</span>
                      {u.creatorProfile ? (
                        <Link
                          href={`/admin/creators/${u.creatorProfile.id}`}
                          className="mt-0.5 block text-[11px] font-semibold text-brand-700"
                        >
                          {u.creatorProfile.displayName} ({u.creatorProfile.code})
                        </Link>
                      ) : null}
                      {u.donorProfile ? (
                        <Link
                          href={`/admin/donors/${u.donorProfile.id}`}
                          className="mt-0.5 block text-[11px] font-semibold text-brand-700"
                        >
                          후원자 상세
                        </Link>
                      ) : null}
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={u.role === 'ADMIN' ? 'brand' : 'neutral'}>{roleLabel[u.role]}</Badge>
                      {u.adminProfile ? (
                        <span className="mt-0.5 block text-[11px] text-ink-400">{u.adminProfile.permission}</span>
                      ) : null}
                    </Td>
                    <Td>{u.phoneMasked ?? '-'}</Td>
                    <Td>
                      <Badge tone={statusLabel[u.status].tone}>{statusLabel[u.status].text}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap">{formatKst(u.lastLoginAt, false)}</Td>
                    <Td className="whitespace-nowrap">{formatKst(u.createdAt, false)}</Td>
                    <Td>
                      <SelectActionForm
                        action={updateUserStatus}
                        values={{ userId: u.id }}
                        name="status"
                        defaultValue={u.status}
                        options={[
                          { value: 'ACTIVE', label: '활성' },
                          { value: 'SUSPENDED', label: '정지' },
                          { value: 'WITHDRAWN', label: '탈퇴' },
                        ]}
                        confirm={`${u.email ?? u.id} 회원의 상태를 변경합니다. 계속할까요?`}
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pager
              basePath="/admin/users"
              params={{ q, role: role ?? '', status: status ?? '' }}
              page={page}
              lastPage={lastPage}
              total={total}
            />
          </>
        )}
      </div>
    </>
  );
}
