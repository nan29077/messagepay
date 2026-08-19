import Link from 'next/link';
import { Radio, MonitorPlay, Hash } from 'lucide-react';
import { Card, CardTitle, Badge, EmptyState, Notice, LinkButton, StatTile } from '@/components/ui';
import { RefundRequestForm } from '@/components/my/refund-request-form';
import { requireDonorContext, NO_DONOR_TITLE, NO_DONOR_DESC } from '@/components/my/donor';
import { prisma } from '@/server/db';
import { formatWon, formatNumber } from '@/lib/money';
import { formatKst } from '@/lib/datetime';
import { donationStatusLabel, deliveryStatusLabel, refundStatusLabel } from '@/lib/labels';
import type { DonationStatus } from '@/generated/prisma/enums';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

/** 결제가 완료되어 환불 요청이 가능한 상태 */
const REFUNDABLE: DonationStatus[] = [
  'PAYMENT_SUCCESS',
  'BROADCAST_PENDING',
  'BROADCASTED',
  'PARTIAL_DELIVERY_FAILED',
  'SETTLEMENT_PENDING',
  'SETTLED',
];

export default async function MyDonationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { donorId } = await requireDonorContext('/my');
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);

  if (!donorId) {
    return (
      <>
        <EmptyState title={NO_DONOR_TITLE} description={NO_DONOR_DESC} />
        <div className="mt-4">
          <LinkButton href="/how-it-works" variant="secondary" size="md" className="w-full">
            문자후원 이용방법 보기
          </LinkButton>
        </div>
      </>
    );
  }

  const [total, donations, paidAgg] = await Promise.all([
    prisma.donation.count({ where: { donorId } }),
    prisma.donation.findMany({
      where: { donorId },
      orderBy: { receivedAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        transactionNo: true,
        amount: true,
        message: true,
        status: true,
        receivedAt: true,
        paidAt: true,
        youtubeStatus: true,
        overlayStatus: true,
        creator: { select: { displayName: true, code: true } },
        refunds: {
          orderBy: { requestedAt: 'desc' },
          take: 1,
          select: { status: true, requestedAt: true },
        },
      },
    }),
    prisma.donation.aggregate({
      where: { donorId, status: { in: REFUNDABLE } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2.5">
        <StatTile label="누적 후원 금액" value={formatWon(paidAgg._sum.amount ?? 0n)} tone="brand" sub="결제 완료 기준" />
        <StatTile label="후원 건수" value={`${formatNumber(paidAgg._count._all)}건`} sub={`전체 기록 ${formatNumber(total)}건`} />
      </div>

      {donations.length === 0 ? (
        <EmptyState title="후원 내역이 없습니다" description="크리에이터의 후원 번호로 문자를 보내면 이곳에 표시됩니다." />
      ) : (
        <div className="space-y-2.5">
          {donations.map((d) => {
            const status = donationStatusLabel[d.status];
            const refund = d.refunds[0] ?? null;
            const refundOpen = refund ? ['REQUESTED', 'APPROVED', 'DONE'].includes(refund.status) : false;
            const canRefund = REFUNDABLE.includes(d.status) && !refundOpen;

            return (
              <Card key={d.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={status.tone}>{status.text}</Badge>
                      {refund ? (
                        <Badge tone={refundStatusLabel[refund.status].tone}>
                          환불 {refundStatusLabel[refund.status].text}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-2 text-[14.5px] font-bold text-ink-900">
                      <Link href={`/c/${d.creator.code}`} className="hover:text-brand-600">
                        {d.creator.displayName}
                      </Link>
                    </p>
                  </div>
                  <p className="shrink-0 text-[18px] font-extrabold tracking-tight text-ink-900">
                    {formatWon(d.amount)}
                  </p>
                </div>

                {d.message ? (
                  <p className="mt-2 break-words rounded-xl bg-ink-50 px-3 py-2.5 text-[13px] leading-relaxed text-ink-700">
                    {d.message}
                  </p>
                ) : null}

                <dl className="mt-3 space-y-1.5 border-t border-ink-100 pt-3 text-[12.5px]">
                  <div className="flex items-start justify-between gap-3">
                    <dt className="flex items-center gap-1 text-ink-400">
                      <Hash size={13} strokeWidth={1.8} />
                      거래번호
                    </dt>
                    <dd className="break-all text-right font-mono font-semibold text-ink-900">{d.transactionNo}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-ink-400">접수 일시</dt>
                    <dd className="tabular-nums text-ink-700">{formatKst(d.receivedAt, false)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-ink-400">결제 일시</dt>
                    <dd className="tabular-nums text-ink-700">{d.paidAt ? formatKst(d.paidAt, false) : '-'}</dd>
                  </div>
                </dl>

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3">
                  <DeliveryChip
                    icon={<Radio size={13} strokeWidth={1.8} />}
                    label="유튜브 채팅"
                    status={d.youtubeStatus}
                  />
                  <DeliveryChip
                    icon={<MonitorPlay size={13} strokeWidth={1.8} />}
                    label="방송 오버레이"
                    status={d.overlayStatus}
                  />
                </div>

                <div className="mt-3">
                  <RefundRequestForm
                    donationId={d.id}
                    disabled={!canRefund}
                    disabledReason={
                      refundOpen
                        ? `환불 ${refundStatusLabel[refund!.status].text} 상태`
                        : '결제 완료 건만 환불 요청 가능'
                    }
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {lastPage > 1 ? (
        <nav className="flex items-center justify-between gap-3">
          {page > 1 ? (
            <LinkButton href={`/my?page=${page - 1}`} variant="secondary" size="sm">
              이전
            </LinkButton>
          ) : (
            <span />
          )}
          <span className="text-[12.5px] font-semibold tabular-nums text-ink-500">
            {page} / {lastPage}
          </span>
          {page < lastPage ? (
            <LinkButton href={`/my?page=${page + 1}`} variant="secondary" size="sm">
              다음
            </LinkButton>
          ) : (
            <span />
          )}
        </nav>
      ) : null}

      <Card>
        <CardTitle>후원 내역이 보이지 않나요</CardTitle>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">
          문자후원 내역은 계좌 등록 시 사용한 휴대전화 번호를 기준으로 연결됩니다. 연결이 필요하면 고객센터로 문의해
          주세요.
        </p>
      </Card>

      <Notice tone="neutral">
        현재 서비스는 준비 단계로 실제 결제와 문자 발송은 비활성화되어 있습니다. 표시되는 결제·송출 상태는 모의(mock)
        처리 결과일 수 있습니다.
      </Notice>
    </div>
  );
}

function DeliveryChip({
  icon,
  label,
  status,
}: {
  icon: React.ReactNode;
  label: string;
  status: keyof typeof deliveryStatusLabel;
}) {
  const s = deliveryStatusLabel[status];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-ink-50 px-2.5 py-1.5 text-[12px] text-ink-500">
      <span className="text-ink-400">{icon}</span>
      {label}
      <Badge tone={s.tone}>{s.text}</Badge>
    </span>
  );
}
