import Link from 'next/link';
import { PageHeader } from '@/components/layout/console-shell';
import { Badge, EmptyState, Notice, StatTile, Table, Td, Th } from '@/components/ui';
import { AdminField, AdminInput, AdminSelect, FilterBar, Pager } from '@/components/admin/controls';
import { ActionButton, ActionForm } from '@/components/admin/action-form';
import { PAGE_SIZE, parsePage, PAID_DONATION_STATUSES } from '@/components/admin/constants';
import { bankLabel } from '@/components/admin/mask';
import { unlockDonor, setDonorBlock, updateDonorLimitsByAdmin } from '@/app/actions/admin/accounts';
import { prisma } from '@/server/db';
import { formatWon, formatNumber } from '@/lib/money';
import { formatKst } from '@/lib/datetime';
import type { Prisma } from '@/generated/prisma/client';
import { donorOnboardingStatusLabel } from '@/lib/labels';

export const dynamic = 'force-dynamic';

type StateFilter = '' | 'LOCKED' | 'BLOCKED' | 'REGISTERED' | 'UNREGISTERED';

export default async function AdminDonorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; state?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const q = (sp.q ?? '').trim();
  const state = (['LOCKED', 'BLOCKED', 'REGISTERED', 'UNREGISTERED'].includes(sp.state ?? '')
    ? sp.state
    : '') as StateFilter;

  const now = new Date();
  const where: Prisma.DonorProfileWhereInput = {
    ...(q ? { phoneMasked: { contains: q } } : {}),
    ...(state === 'LOCKED' ? { lockedUntil: { gt: now } } : {}),
    ...(state === 'BLOCKED' ? { blockedAt: { not: null } } : {}),
    ...(state === 'REGISTERED' ? { registeredAt: { not: null } } : {}),
    ...(state === 'UNREGISTERED' ? { registeredAt: null } : {}),
  };

  const [total, donors, lockedCount, blockedCount, registeredCount] = await Promise.all([
    prisma.donorProfile.count({ where }),
    prisma.donorProfile.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, phoneMasked: true, displayName: true, createdAt: true, registeredAt: true,
        onboardingStatus: true, registrationLinkSentAt: true,
        failCount: true, lockedUntil: true, blockedAt: true, blockedReason: true,
        dailyLimit: true, monthlyLimit: true,
        paymentTokens: {
          where: { status: 'ACTIVE' },
          select: { bankName: true, accountTail4: true, registeredAt: true },
          take: 1,
          orderBy: { registeredAt: 'desc' },
        },
      },
    }),
    prisma.donorProfile.count({ where: { lockedUntil: { gt: now } } }),
    prisma.donorProfile.count({ where: { blockedAt: { not: null } } }),
    prisma.donorProfile.count({ where: { registeredAt: { not: null } } }),
  ]);

  const donorIds = donors.map((d) => d.id);
  const totals = donorIds.length
    ? await prisma.donation.groupBy({
        by: ['donorId'],
        where: { donorId: { in: donorIds }, status: { in: PAID_DONATION_STATUSES } },
        _sum: { amount: true },
        _count: { _all: true },
      })
    : [];
  const totalMap = new Map(totals.map((t) => [t.donorId ?? '', t]));

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="이용자 관리"
        description="문자만으로 생성된 이용자를 포함합니다. 전화번호는 마스킹, 계좌는 은행명과 끝 4자리만 표시합니다."
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatTile label="전체 이용자" value={formatNumber(total)} sub="현재 조건 기준" />
        <StatTile label="계좌 등록 완료" value={formatNumber(registeredCount)} tone="success" />
        <StatTile label="결제 실패 잠금" value={formatNumber(lockedCount)} tone={lockedCount > 0 ? 'warning' : 'neutral'} />
        <StatTile label="이용 제한" value={formatNumber(blockedCount)} tone={blockedCount > 0 ? 'danger' : 'neutral'} />
      </div>

      <FilterBar action="/admin/donors" resetHref="/admin/donors">
        <AdminField label="연락처 검색 (마스킹 기준)" className="w-56">
          <AdminInput name="q" defaultValue={q} placeholder="010-****-1234" />
        </AdminField>
        <AdminField label="상태" className="w-44">
          <AdminSelect name="state" defaultValue={state}>
            <option value="">전체</option>
            <option value="REGISTERED">계좌 등록 완료</option>
            <option value="UNREGISTERED">계좌 미등록</option>
            <option value="LOCKED">결제 실패 잠금</option>
            <option value="BLOCKED">이용 제한</option>
          </AdminSelect>
        </AdminField>
      </FilterBar>

      <Notice tone="neutral" title="잠금과 이용 제한은 다릅니다">
        결제 실패 잠금은 연속 실패로 자동 설정되며 관리자 해제 전까지 결제가 접수되지 않습니다. 이용 제한은 운영 판단에
        따른 수동 차단입니다.
      </Notice>

      <div className="mt-4">
        {donors.length === 0 ? (
          <EmptyState title="조건에 맞는 이용자가 없습니다" />
        ) : (
          <>
            <Table className="min-w-[1100px]">
              <thead>
                <tr>
                  <Th>연락처</Th>
                  <Th>등록일</Th>
                  <Th>계좌 등록</Th>
                  <Th className="text-right">누적 결제</Th>
                  <Th className="text-right">실패</Th>
                  <Th>잠금·제한</Th>
                  <Th>개인 한도</Th>
                  <Th>처리</Th>
                </tr>
              </thead>
              <tbody>
                {donors.map((d) => {
                  const agg = totalMap.get(d.id);
                  const token = d.paymentTokens[0];
                  const locked = d.lockedUntil != null && d.lockedUntil > now;
                  return (
                    <tr key={d.id}>
                      <Td>
                        <Link href={`/admin/donors/${d.id}`} className="font-semibold text-brand-700">
                          {d.phoneMasked}
                        </Link>
                        {d.displayName ? (
                          <span className="mt-0.5 block text-[11px] text-ink-400">{d.displayName}</span>
                        ) : null}
                      </Td>
                      <Td className="whitespace-nowrap">{formatKst(d.createdAt, false)}</Td>
                      <Td>
                        {token ? (
                          <>
                            <Badge tone={donorOnboardingStatusLabel[d.onboardingStatus].tone}>
                              {donorOnboardingStatusLabel[d.onboardingStatus].text}
                            </Badge>
                            <span className="mt-0.5 block text-[11px] text-ink-500">
                              {bankLabel(token.bankName, token.accountTail4)}
                            </span>
                          </>
                        ) : (
                          <>
                            <Badge tone={donorOnboardingStatusLabel[d.onboardingStatus].tone}>
                              {donorOnboardingStatusLabel[d.onboardingStatus].text}
                            </Badge>
                            {d.registrationLinkSentAt ? (
                              <span className="mt-0.5 block text-[11px] text-ink-400">
                                {formatKst(d.registrationLinkSentAt, false)}
                              </span>
                            ) : null}
                          </>
                        )}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {formatWon(agg?._sum.amount ?? 0n)}
                        <span className="mt-0.5 block text-[11px] text-ink-400">{formatNumber(agg?._count._all ?? 0)}건</span>
                      </Td>
                      <Td className="text-right tabular-nums">{formatNumber(d.failCount)}</Td>
                      <Td>
                        {locked ? <Badge tone="warning">잠금 {formatKst(d.lockedUntil, false)}</Badge> : null}
                        {d.blockedAt ? (
                          <>
                            <Badge tone="danger">이용 제한</Badge>
                            <span className="mt-0.5 block max-w-[160px] text-[11px] break-words text-ink-400">
                              {d.blockedReason ?? '-'}
                            </span>
                          </>
                        ) : null}
                        {!locked && !d.blockedAt ? <Badge tone="success">정상</Badge> : null}
                      </Td>
                      <Td className="text-[12px]">
                        <details>
                          <summary className="cursor-pointer text-brand-700">
                            {d.dailyLimit != null || d.monthlyLimit != null ? '개별 설정됨' : '정책 기본값'}
                          </summary>
                          <div className="mt-2 w-52">
                            <ActionForm action={updateDonorLimitsByAdmin} submitLabel="한도 저장" variant="secondary" compact>
                              <input type="hidden" name="donorId" value={d.id} />
                              <AdminField label="일 한도 (비우면 정책값)">
                                <AdminInput
                                  name="dailyLimit"
                                  inputMode="numeric"
                                  defaultValue={d.dailyLimit != null ? d.dailyLimit.toString() : ''}
                                />
                              </AdminField>
                              <AdminField label="월 한도 (비우면 정책값)">
                                <AdminInput
                                  name="monthlyLimit"
                                  inputMode="numeric"
                                  defaultValue={d.monthlyLimit != null ? d.monthlyLimit.toString() : ''}
                                />
                              </AdminField>
                            </ActionForm>
                          </div>
                        </details>
                      </Td>
                      <Td>
                        <div className="flex flex-col gap-1.5">
                          <ActionButton
                            action={unlockDonor}
                            values={{ donorId: d.id }}
                            label="잠금 해제"
                            disabled={!locked && d.failCount === 0}
                            confirm="결제 실패 잠금을 해제하고 실패 횟수를 0으로 되돌립니다."
                          />
                          {d.blockedAt ? (
                            <ActionButton
                              action={setDonorBlock}
                              values={{ donorId: d.id, next: 'UNBLOCK' }}
                              label="제한 해제"
                              confirm="이 이용자의 이용 제한을 해제합니다."
                            />
                          ) : (
                            <details>
                              <summary className="cursor-pointer text-[12px] text-danger-500">이용 제한</summary>
                              <div className="mt-1.5 w-48">
                                <ActionForm
                                  action={setDonorBlock}
                                  submitLabel="제한 적용"
                                  variant="danger"
                                  compact
                                  confirm="이 이용자의 이용을 제한합니다. 이후 문자결제가 접수되지 않습니다."
                                >
                                  <input type="hidden" name="donorId" value={d.id} />
                                  <input type="hidden" name="next" value="BLOCK" />
                                  <AdminField label="제한 사유">
                                    <AdminInput name="reason" placeholder="예: 반복 분쟁 신고" />
                                  </AdminField>
                                </ActionForm>
                              </div>
                            </details>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pager
              basePath="/admin/donors"
              params={{ q, state }}
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
