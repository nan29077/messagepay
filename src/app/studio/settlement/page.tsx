import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge, Card, CardTitle, DataRow, EmptyState, Field, Input, Notice, SectionTitle, Select, StatTile, Table, Td, Textarea, Th, cx } from '@/components/ui';
import { PageHeader } from '@/components/layout/console-shell';
import { ActionForm } from '@/components/studio/action-form';
import { BANKS } from '@/components/studio/banks';
import { requestSettlementAction, saveSettlementAccountAction } from '@/app/actions/studio';
import { requireCreator } from '@/server/auth';
import { prisma } from '@/server/db';
import { getSettlementSummary, resolveFeePolicy } from '@/server/services/settlement';
import { applyRate, formatWon, formatNumber } from '@/lib/money';
import { formatKst, kstDateKey, kstMonthKey } from '@/lib/datetime';
import { ledgerEntryLabel, settlementStatusLabel } from '@/lib/labels';

export const dynamic = 'force-dynamic';

const WITHHOLDING_RATE = 0.033;

/** 결제가 완료된 후원 상태 (캘린더 일별 합계 기준) */
const PAID_STATUSES = ['BROADCASTED', 'SETTLEMENT_PENDING', 'PARTIAL_DELIVERY_FAILED', 'SETTLED'] as const;

function ratePercent(rate: string): string {
  return `${(Number(rate) * 100).toFixed(2)}%`;
}

/** YYYY-MM 검증 후 KST 기준 월 시작/끝을 돌려준다. */
function monthRange(ym: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  const now = kstMonthKey();
  const key = m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? ym : now;
  const [y, mo] = key.split('-').map(Number);
  const start = new Date(`${key}-01T00:00:00+09:00`);
  const nextKey = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  const prevKey = mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
  const end = new Date(`${nextKey}-01T00:00:00+09:00`);
  return { key, start, end, prevKey, nextKey, year: y, month: mo };
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export default async function StudioSettlementPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { creatorId } = await requireCreator();
  const sp = await searchParams;
  const range = monthRange(sp.month ?? kstMonthKey());

  const [summary, feePolicy, ledger, requests, account, monthDonations, monthPayouts] = await Promise.all([
    getSettlementSummary(creatorId),
    resolveFeePolicy(creatorId),
    prisma.settlementLedger.findMany({
      where: { creatorId },
      orderBy: { occurredAt: 'desc' },
      take: 50,
      select: { id: true, entryType: true, amount: true, memo: true, occurredAt: true, settlementKey: true },
    }),
    prisma.settlementRequest.findMany({
      where: { creatorId },
      orderBy: { requestedAt: 'desc' },
      take: 20,
    }),
    prisma.settlementAccount.findUnique({
      where: { creatorId },
      select: {
        bankCode: true, bankName: true, accountTail4: true, holderMasked: true,
        verified: true, verifiedAt: true, updatedAt: true,
      },
    }),
    prisma.donation.findMany({
      where: {
        creatorId,
        status: { in: [...PAID_STATUSES] },
        paidAt: { gte: range.start, lt: range.end },
      },
      select: { paidAt: true, amount: true },
    }),
    prisma.settlementRequest.findMany({
      where: { creatorId, paidAt: { gte: range.start, lt: range.end } },
      select: { paidAt: true, payoutAmount: true },
    }),
  ]);

  // ── 일별 집계 (KST) ─────────────────────────────────────────────
  const byDay = new Map<string, { amount: bigint; count: number }>();
  let monthTotal = 0n;
  for (const d of monthDonations) {
    if (!d.paidAt) continue;
    const k = kstDateKey(d.paidAt);
    const cur = byDay.get(k) ?? { amount: 0n, count: 0 };
    cur.amount += d.amount;
    cur.count += 1;
    byDay.set(k, cur);
    monthTotal += d.amount;
  }
  const payoutByDay = new Map<string, bigint>();
  for (const p of monthPayouts) {
    if (!p.paidAt) continue;
    const k = kstDateKey(p.paidAt);
    payoutByDay.set(k, (payoutByDay.get(k) ?? 0n) + p.payoutAmount);
  }

  // ── 캘린더 격자 구성 ────────────────────────────────────────────
  const firstDow = new Date(range.start.getTime() + 9 * 3600_000).getUTCDay();
  const daysInMonth = Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000);
  const todayKey = kstDateKey();
  const cells: Array<{ day: number; key: string } | null> = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => ({
      day: i + 1,
      key: `${range.key}-${String(i + 1).padStart(2, '0')}`,
    })),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const previewWithholding = applyRate(summary.available, WITHHOLDING_RATE);
  const isCurrentMonth = range.key === kstMonthKey();

  return (
    <>
      <PageHeader
        title="정산 관리"
        description="일별 후원 현황을 캘린더로 확인하고, 정산 요청과 지급 계좌를 한 화면에서 관리합니다."
      />

      <div className="space-y-5">
        {/* 핵심 요약 */}
        <section>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <StatTile
              label={`${range.month}월 후원 합계`}
              value={formatWon(monthTotal)}
              sub={`${formatNumber(monthDonations.length)}건 결제 완료`}
            />
            <StatTile label="정산 가능금" value={formatWon(summary.available)} tone="brand" />
            <StatTile label="정산 보류금" value={formatWon(summary.pending)} sub="요청 검토 중" tone="warning" />
            <StatTile label="정산 완료금" value={formatWon(summary.totalPaid)} tone="success" />
          </div>
        </section>

        {/* 캘린더 */}
        <section>
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <CardTitle>
                {range.year}년 {range.month}월
              </CardTitle>
              <div className="flex items-center gap-1.5">
                <Link
                  href={`/studio/settlement?month=${range.prevKey}`}
                  aria-label="이전 달"
                  className="grid h-9 w-9 place-items-center rounded-lg border border-ink-200 text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-900"
                >
                  <ChevronLeft size={16} strokeWidth={1.8} />
                </Link>
                {!isCurrentMonth ? (
                  <Link
                    href="/studio/settlement"
                    className="flex h-9 items-center rounded-lg border border-ink-200 px-3 text-[12px] font-bold text-ink-700 transition-colors hover:bg-ink-50"
                  >
                    이번 달
                  </Link>
                ) : null}
                <Link
                  href={`/studio/settlement?month=${range.nextKey}`}
                  aria-label="다음 달"
                  className="grid h-9 w-9 place-items-center rounded-lg border border-ink-200 text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-900"
                >
                  <ChevronRight size={16} strokeWidth={1.8} />
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-7 border-b border-ink-100 pb-2">
              {WEEKDAYS.map((w, i) => (
                <p
                  key={w}
                  className={cx(
                    'text-center text-[11px] font-extrabold',
                    i === 0 ? 'text-danger-500' : i === 6 ? 'text-brand-700' : 'text-ink-400',
                  )}
                >
                  {w}
                </p>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {cells.map((cell, i) => {
                if (!cell) return <div key={`e${i}`} className="min-h-[72px] border-b border-ink-50 sm:min-h-[84px]" />;
                const stat = byDay.get(cell.key);
                const payout = payoutByDay.get(cell.key);
                const isToday = cell.key === todayKey;
                const dow = i % 7;
                return (
                  <div
                    key={cell.key}
                    className={cx(
                      'min-h-[72px] border-b border-ink-50 px-1 py-1.5 sm:min-h-[84px] sm:px-1.5',
                      isToday && 'rounded-lg bg-brand-50/70',
                    )}
                  >
                    <p
                      className={cx(
                        'text-[11px] font-bold tabular-nums',
                        isToday
                          ? 'inline-grid h-5 w-5 place-items-center rounded-full bg-brand-400 text-center text-ink-900'
                          : dow === 0
                            ? 'text-danger-500'
                            : dow === 6
                              ? 'text-brand-700'
                              : 'text-ink-400',
                      )}
                    >
                      {cell.day}
                    </p>
                    {stat ? (
                      <div className="mt-1">
                        <p className="truncate text-[10.5px] font-extrabold tabular-nums text-ink-900 sm:text-[12px]">
                          {formatWon(stat.amount)}
                        </p>
                        <p className="text-[9.5px] tabular-nums text-ink-400 sm:text-[10.5px]">{stat.count}건</p>
                      </div>
                    ) : null}
                    {payout ? (
                      <p className="mt-0.5 truncate rounded bg-[#e8f7f0] px-1 py-0.5 text-[9px] font-bold text-[#0b7d59] sm:text-[10px]">
                        지급 {formatWon(payout)}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink-400">
              날짜별 금액은 해당 날짜(KST)에 결제가 완료된 후원의 합계입니다. 초록 배지는 정산금이 지급된 날입니다.
            </p>
          </Card>
        </section>

        {/* 정산 요청 */}
        <section>
          <SectionTitle title="정산 요청" />
          <Card>
            <div className="mb-3">
              <DataRow
                label="정산 계좌"
                value={
                  account ? (
                    <span>
                      {account.bankName} ****{account.accountTail4} · {account.holderMasked}{' '}
                      {account.verified ? <Badge tone="success">인증됨</Badge> : <Badge tone="warning">미인증</Badge>}
                    </span>
                  ) : (
                    <Badge tone="warning">미등록</Badge>
                  )
                }
              />
              <DataRow label="정산 가능금" value={formatWon(summary.available)} />
              <DataRow label="원천징수 예상 (3.3%)" value={formatWon(previewWithholding)} />
              <DataRow label="실지급 예상" value={formatWon(summary.available - previewWithholding)} />
            </div>

            {!account || !account.verified ? (
              <Notice tone="warning" title="정산 계좌 인증이 필요합니다">
                계좌가 등록되지 않았거나 예금주 실명확인이 완료되지 않아 정산을 요청할 수 없습니다. 아래 정산 계좌
                섹션에서 계좌를 먼저 등록해 주세요.
              </Notice>
            ) : summary.available <= 0n ? (
              <Notice tone="neutral">현재 정산 가능한 금액이 없습니다.</Notice>
            ) : (
              <ActionForm action={requestSettlementAction} submitLabel="정산 요청">
                <Field label="요청 금액 (원)" hint={`정산 가능금 ${formatWon(summary.available)} 이하로 입력해 주세요.`}>
                  <Input
                    name="amount"
                    inputMode="numeric"
                    defaultValue={summary.available.toString()}
                    className="tabular-nums"
                  />
                </Field>
                <Field label="메모 (선택)" hint="200자 이내">
                  <Textarea name="memo" rows={2} maxLength={200} placeholder="정산 담당자에게 전달할 내용" />
                </Field>
              </ActionForm>
            )}

            <div className="mt-3">
              <Notice tone="neutral">
                원천징수는 사업소득 3.3% 기준으로 계산됩니다. 원천징수 세율은 세무 검토 후 확정됩니다. 사업자 등록
                여부와 소득 구분에 따라 실제 적용 세율이 달라질 수 있습니다.
              </Notice>
            </div>
          </Card>
        </section>

        {/* 정산 요청 내역 */}
        <section>
          <SectionTitle title="정산 요청 내역" description="최근 20건입니다." />
          {requests.length === 0 ? (
            <EmptyState title="정산 요청 내역이 없습니다" />
          ) : (
            <Table className="min-w-full">
              <thead>
                <tr>
                  <Th>요청일</Th>
                  <Th>상태</Th>
                  <Th className="text-right">요청금</Th>
                  <Th className="text-right">원천징수</Th>
                  <Th className="text-right">실지급액</Th>
                  <Th>메모</Th>
                  <Th>지급일</Th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => {
                  const st = settlementStatusLabel[r.status];
                  return (
                    <tr key={r.id}>
                      <Td className="whitespace-nowrap tabular-nums">{formatKst(r.requestedAt, false)}</Td>
                      <Td>
                        <Badge tone={st.tone}>{st.text}</Badge>
                      </Td>
                      <Td className="text-right tabular-nums">{formatWon(r.amount)}</Td>
                      <Td className="text-right tabular-nums text-danger-500">-{formatWon(r.withholding)}</Td>
                      <Td className="text-right font-semibold tabular-nums text-ink-900">{formatWon(r.payoutAmount)}</Td>
                      <Td>{r.memo ?? '-'}</Td>
                      <Td className="whitespace-nowrap tabular-nums">{formatKst(r.paidAt, false)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </section>

        {/* 정산 계좌 (통합) */}
        <section id="account">
          <SectionTitle
            title="정산 계좌"
            description="정산금을 지급받을 계좌입니다. 변경하면 인증 상태가 초기화되어 다시 관리자 확인을 거칩니다."
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              {account ? (
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <CardTitle>{account.bankName}</CardTitle>
                    {account.verified ? <Badge tone="success">인증 완료</Badge> : <Badge tone="warning">인증 대기</Badge>}
                  </div>
                  <DataRow label="계좌번호" value={`****${account.accountTail4}`} />
                  <DataRow label="예금주" value={account.holderMasked} />
                  <DataRow label="마지막 수정" value={formatKst(account.updatedAt)} />
                  <DataRow label="인증 시각" value={formatKst(account.verifiedAt)} />
                  <p className="mt-2 text-[12px] leading-relaxed text-ink-400">
                    계좌번호와 예금주는 암호화되어 저장되며 화면에는 은행명과 끝 4자리만 표시됩니다.
                  </p>
                </div>
              ) : (
                <Notice tone="neutral">등록된 정산 계좌가 없습니다. 오른쪽에서 계좌를 등록해 주세요.</Notice>
              )}
              <div className="mt-3">
                <Notice tone="warning" title="계좌 실명확인은 아직 mock 단계입니다">
                  예금주 실명확인 API 계약 전이라 저장해도 자동 인증되지 않습니다. 통합 관리자가 확인한 뒤 인증 상태로
                  전환되며, 인증 전에는 정산을 요청할 수 없습니다.
                </Notice>
              </div>
            </Card>

            <Card>
              <CardTitle>{account ? '계좌 변경' : '계좌 등록'}</CardTitle>
              <div className="mt-3">
                <ActionForm action={saveSettlementAccountAction} submitLabel={account ? '계좌 변경' : '계좌 등록'}>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="은행" required>
                      <Select name="bankCode" defaultValue={account?.bankCode ?? '004'}>
                        {BANKS.map((b) => (
                          <option key={b.code} value={b.code}>
                            {b.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="예금주" hint="사업자 계좌라면 사업자명과 동일해야 합니다." required>
                      <Input name="holderName" maxLength={30} placeholder="예금주명" autoComplete="off" />
                    </Field>
                  </div>
                  <Field label="계좌번호" hint="숫자만 입력해 주세요. (8~20자리)" required>
                    <Input
                      name="account"
                      inputMode="numeric"
                      maxLength={24}
                      placeholder="- 없이 숫자만"
                      autoComplete="off"
                      className="tabular-nums"
                    />
                  </Field>
                </ActionForm>
              </div>
            </Card>
          </div>
        </section>

        {/* 누적 정산 요약 + 수수료 정책 */}
        <section>
          <SectionTitle title="누적 정산 요약" description="정산 원장 기준 누적 금액입니다." />
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <StatTile label="총 후원금" value={formatWon(summary.totalGross)} />
            <StatTile label="결제수수료" value={formatWon(-summary.totalPgFee)} tone="danger" />
            <StatTile label="플랫폼수수료" value={formatWon(-summary.totalPlatformFee)} tone="danger" />
            <StatTile label="환불·차감" value={formatWon(-summary.totalRefund)} tone="danger" />
          </div>
          {summary.totalAdjustment !== 0n ? (
            <div className="mt-2.5">
              <Notice tone="neutral">
                관리자 조정 분개가 {formatWon(summary.totalAdjustment)} 반영되어 있습니다. 상세 내용은 아래 원장에서
                확인해 주세요.
              </Notice>
            </div>
          ) : null}
          <div className="mt-3">
            <Card>
              <CardTitle>적용 중인 수수료 정책</CardTitle>
              <div className="mt-2">
                {feePolicy ? (
                  <div>
                    <DataRow label="적용 범위" value={feePolicy.scope === 'CREATOR' ? '내 채널 전용 정책' : '플랫폼 공통 정책'} />
                    <DataRow label="결제수수료율" value={ratePercent(feePolicy.pgFeeRate.toString())} />
                    <DataRow label="결제 건당 고정비" value={formatWon(feePolicy.pgFixedFee)} />
                    <DataRow label="플랫폼수수료율" value={ratePercent(feePolicy.platformFeeRate.toString())} />
                    <DataRow label="문자 원가" value={formatWon(feePolicy.smsCost)} />
                    <DataRow label="부가세 포함 여부" value={feePolicy.vatIncluded ? '포함' : '미포함'} />
                    <DataRow label="적용 시작" value={formatKst(feePolicy.effectiveFrom, false)} />
                  </div>
                ) : (
                  <Notice tone="warning">적용 중인 수수료 정책이 없습니다. 고객센터로 문의해 주세요.</Notice>
                )}
              </div>
            </Card>
          </div>
        </section>

        {/* 원장 */}
        <section>
          <SectionTitle
            title="정산 원장"
            description="최근 50건입니다. 원장은 수정·삭제되지 않으며 정정은 반대 분개로 기록됩니다."
          />
          {ledger.length === 0 ? (
            <EmptyState title="원장 기록이 없습니다" description="결제가 완료된 후원이 발생하면 자동으로 기록됩니다." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>발생 시각</Th>
                  <Th>구분</Th>
                  <Th className="text-right">금액</Th>
                  <Th>정산월</Th>
                  <Th>메모</Th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((e) => (
                  <tr key={e.id}>
                    <Td className="whitespace-nowrap tabular-nums">{formatKst(e.occurredAt, false)}</Td>
                    <Td className="whitespace-nowrap">{ledgerEntryLabel[e.entryType]}</Td>
                    <Td
                      className={
                        e.amount < 0n
                          ? 'whitespace-nowrap text-right font-semibold tabular-nums text-danger-500'
                          : 'whitespace-nowrap text-right font-semibold tabular-nums text-success-500'
                      }
                    >
                      {e.amount >= 0n ? '+' : ''}
                      {formatWon(e.amount)}
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums">{e.settlementKey}</Td>
                    <Td>{e.memo ?? '-'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>

        <Card>
          <CardTitle>정산 절차 안내</CardTitle>
          <ol className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-ink-500">
            <li>1. 결제가 승인되면 후원 총액과 수수료가 정산 원장에 자동 기록됩니다.</li>
            <li>2. 환불이 발생하면 반대 분개로 차감되고 플랫폼수수료는 환입됩니다.</li>
            <li>3. 정산 가능금 범위에서 요청하면 통합 관리자 검토 후 지급됩니다.</li>
            <li>4. 지급이 완료되면 원장에 지급·원천징수 분개가 추가되고 캘린더에 지급일이 표시됩니다.</li>
          </ol>
        </Card>
      </div>
    </>
  );
}
