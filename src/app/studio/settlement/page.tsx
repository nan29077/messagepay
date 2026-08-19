import { Badge, Card, CardTitle, DataRow, EmptyState, Field, Input, LinkButton, Notice, SectionTitle, StatTile, Table, Td, Textarea, Th } from '@/components/ui';
import { PageHeader } from '@/components/layout/console-shell';
import { ActionForm } from '@/components/studio/action-form';
import { requestSettlementAction } from '@/app/actions/studio';
import { requireCreator } from '@/server/auth';
import { prisma } from '@/server/db';
import { getSettlementSummary, resolveFeePolicy } from '@/server/services/settlement';
import { applyRate, formatWon } from '@/lib/money';
import { formatKst } from '@/lib/datetime';
import { ledgerEntryLabel, settlementStatusLabel } from '@/lib/labels';

export const dynamic = 'force-dynamic';

const WITHHOLDING_RATE = 0.033;

function ratePercent(rate: string): string {
  return `${(Number(rate) * 100).toFixed(2)}%`;
}

export default async function StudioSettlementPage() {
  const { creatorId } = await requireCreator();

  const [summary, feePolicy, ledger, requests, account] = await Promise.all([
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
      select: { bankName: true, accountTail4: true, holderMasked: true, verified: true },
    }),
  ]);

  const previewWithholding = applyRate(summary.available, WITHHOLDING_RATE);

  return (
    <>
      <PageHeader title="정산 관리" description="정산 원장 기준 금액과 정산 요청 내역입니다." />

      <div className="space-y-5">
        <section>
          <SectionTitle title="정산 요약" />
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <StatTile label="총 후원금" value={formatWon(summary.totalGross)} />
            <StatTile label="결제수수료" value={formatWon(-summary.totalPgFee)} tone="danger" />
            <StatTile label="플랫폼수수료" value={formatWon(-summary.totalPlatformFee)} tone="danger" />
            <StatTile label="환불·차감" value={formatWon(-summary.totalRefund)} tone="danger" />
            <StatTile label="정산 예정금" value={formatWon(summary.balance)} sub="원장 순합계" />
            <StatTile label="정산 가능금" value={formatWon(summary.available)} tone="brand" />
            <StatTile label="정산 보류금" value={formatWon(summary.pending)} sub="요청 검토 중" tone="warning" />
            <StatTile label="정산 완료금" value={formatWon(summary.totalPaid)} tone="success" />
          </div>
          {summary.totalAdjustment !== 0n ? (
            <div className="mt-2.5">
              <Notice tone="neutral">
                관리자 조정 분개가 {formatWon(summary.totalAdjustment)} 반영되어 있습니다. 상세 내용은 아래 원장에서
                확인해 주세요.
              </Notice>
            </div>
          ) : null}
        </section>

        <section>
          <SectionTitle title="수수료 정책" description="현재 내 채널에 적용 중인 요율입니다." />
          <Card>
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
          </Card>
        </section>

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
              <div className="space-y-3">
                <Notice tone="warning" title="정산 계좌 인증이 필요합니다">
                  계좌가 등록되지 않았거나 예금주 실명확인이 완료되지 않아 정산을 요청할 수 없습니다. 정산 계좌를 먼저
                  등록해 주세요.
                </Notice>
                <LinkButton href="/studio/settlement/account" size="sm">
                  정산 계좌 등록하기
                </LinkButton>
              </div>
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
            <li>4. 지급이 완료되면 원장에 지급·원천징수 분개가 추가됩니다.</li>
          </ol>
        </Card>
      </div>
    </>
  );
}
