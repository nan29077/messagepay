import { Card, CardTitle, Badge, EmptyState, Table, Th, Td, Notice, LinkButton } from '@/components/ui';
import { requireDonorContext, NO_DONOR_TITLE, NO_DONOR_DESC } from '@/components/my/donor';
import { prisma } from '@/server/db';
import { formatWon } from '@/lib/money';
import { formatKst } from '@/lib/datetime';
import { paymentTxStatusLabel, refundStatusLabel } from '@/lib/labels';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

export default async function MyPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { donorId } = await requireDonorContext('/my/payments');
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);

  if (!donorId) return <EmptyState title={NO_DONOR_TITLE} description={NO_DONOR_DESC} />;

  const where = { donation: { donorId } };
  const [total, txns] = await Promise.all([
    prisma.paymentTransaction.count({ where }),
    prisma.paymentTransaction.findMany({
      where,
      orderBy: { requestedAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        amount: true,
        status: true,
        resultMessage: true,
        requestedAt: true,
        approvedAt: true,
        canceledAt: true,
        donation: {
          select: {
            transactionNo: true,
            creator: { select: { displayName: true } },
            refunds: { orderBy: { requestedAt: 'desc' }, take: 1, select: { status: true } },
          },
        },
      },
    }),
  ]);

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <Notice tone="brand" title="결제 내역 안내">
        문자후원 1건마다 결제 요청이 1건 생성됩니다. 승인되지 않은 요청은 출금되지 않으며, 취소·환불된 건은 상태로
        구분해 표시합니다.
      </Notice>

      {txns.length === 0 ? (
        <EmptyState title="결제 내역이 없습니다" description="결제가 발생하면 이곳에서 승인과 취소 상태를 확인할 수 있습니다." />
      ) : (
        <>
          {/* 모바일: 카드 목록 */}
          <div className="space-y-2.5 lg:hidden">
            {txns.map((t) => {
              const s = paymentTxStatusLabel[t.status];
              const refund = t.donation.refunds[0] ?? null;
              return (
                <Card key={t.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={s.tone}>{s.text}</Badge>
                        {refund ? (
                          <Badge tone={refundStatusLabel[refund.status].tone}>
                            환불 {refundStatusLabel[refund.status].text}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-2 text-[14px] font-bold text-ink-900">{t.donation.creator.displayName}</p>
                    </div>
                    <p className="shrink-0 text-[17px] font-extrabold tracking-tight text-ink-900">
                      {formatWon(t.amount)}
                    </p>
                  </div>
                  <dl className="mt-3 space-y-1.5 border-t border-ink-100 pt-3 text-[12.5px]">
                    <Row label="거래번호" value={<span className="break-all font-mono">{t.donation.transactionNo}</span>} />
                    <Row label="요청 일시" value={formatKst(t.requestedAt, false)} />
                    <Row label="승인 일시" value={t.approvedAt ? formatKst(t.approvedAt, false) : '-'} />
                    <Row label="취소 일시" value={t.canceledAt ? formatKst(t.canceledAt, false) : '-'} />
                    {t.resultMessage ? <Row label="결과" value={t.resultMessage} /> : null}
                  </dl>
                </Card>
              );
            })}
          </div>

          {/* PC: 표 */}
          <div className="hidden lg:block">
            <Table>
              <thead>
                <tr>
                  <Th>거래번호</Th>
                  <Th>크리에이터</Th>
                  <Th>금액</Th>
                  <Th>결제 상태</Th>
                  <Th>환불</Th>
                  <Th>요청</Th>
                  <Th>승인</Th>
                </tr>
              </thead>
              <tbody>
                {txns.map((t) => {
                  const s = paymentTxStatusLabel[t.status];
                  const refund = t.donation.refunds[0] ?? null;
                  return (
                    <tr key={t.id}>
                      <Td className="font-mono text-[12px]">{t.donation.transactionNo}</Td>
                      <Td>{t.donation.creator.displayName}</Td>
                      <Td className="font-semibold tabular-nums text-ink-900">{formatWon(t.amount)}</Td>
                      <Td>
                        <Badge tone={s.tone}>{s.text}</Badge>
                        {t.resultMessage ? (
                          <span className="mt-1 block text-[11.5px] text-ink-400">{t.resultMessage}</span>
                        ) : null}
                      </Td>
                      <Td>
                        {refund ? (
                          <Badge tone={refundStatusLabel[refund.status].tone}>
                            {refundStatusLabel[refund.status].text}
                          </Badge>
                        ) : (
                          <span className="text-ink-300">-</span>
                        )}
                      </Td>
                      <Td className="tabular-nums">{formatKst(t.requestedAt, false)}</Td>
                      <Td className="tabular-nums">{t.approvedAt ? formatKst(t.approvedAt, false) : '-'}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        </>
      )}

      {lastPage > 1 ? (
        <nav className="flex items-center justify-between gap-3">
          {page > 1 ? (
            <LinkButton href={`/my/payments?page=${page - 1}`} variant="secondary" size="sm">
              이전
            </LinkButton>
          ) : (
            <span />
          )}
          <span className="text-[12.5px] font-semibold tabular-nums text-ink-500">
            {page} / {lastPage}
          </span>
          {page < lastPage ? (
            <LinkButton href={`/my/payments?page=${page + 1}`} variant="secondary" size="sm">
              다음
            </LinkButton>
          ) : (
            <span />
          )}
        </nav>
      ) : null}

      <Card>
        <CardTitle>결제가 이상한가요</CardTitle>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">
          중복 결제나 승인되지 않은 출금이 확인되면 거래번호와 함께 고객센터로 접수해 주세요.
        </p>
        <LinkButton href="/support" variant="secondary" size="md" className="mt-3">
          고객센터 문의
        </LinkButton>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-ink-400">{label}</dt>
      <dd className="text-right tabular-nums text-ink-700">{value}</dd>
    </div>
  );
}
