import Link from 'next/link';
import { CircleAlert, CircleCheck, MessageSquareText } from 'lucide-react';
import {
  Badge,
  Card,
  CardTitle,
  EmptyState,
  LinkButton,
  Notice,
  SectionTitle,
  StatTile,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/console-shell';
import { PAID_STATUSES } from '@/components/studio/shared';
import { requireCreator } from '@/server/auth';
import { prisma } from '@/server/db';
import { getSettlementSummary } from '@/server/services/settlement';
import { formatNumber, formatWon } from '@/lib/money';
import { formatKst, kstMonthKey, kstStartOfDay } from '@/lib/datetime';
import { donationStatusLabel, moNumberStatusLabel } from '@/lib/labels';

export const dynamic = 'force-dynamic';

export default async function StudioDashboardPage() {
  const { creatorId } = await requireCreator();
  const todayStart = kstStartOfDay();

  const [
    todayAmount,
    todayMessages,
    todaySuccess,
    todayFailed,
    monthLedger,
    summary,
    youtube,
    stream,
    moNumber,
    recent,
  ] = await Promise.all([
    prisma.donation.aggregate({
      where: { creatorId, receivedAt: { gte: todayStart }, status: { in: PAID_STATUSES } },
      _sum: { amount: true },
    }),
    prisma.moInboundMessage.count({ where: { creatorId, receivedAt: { gte: todayStart } } }),
    prisma.donation.count({
      where: { creatorId, receivedAt: { gte: todayStart }, status: { in: PAID_STATUSES } },
    }),
    prisma.donation.count({
      where: { creatorId, receivedAt: { gte: todayStart }, status: 'PAYMENT_FAILED' },
    }),
    prisma.settlementLedger.aggregate({
      where: {
        creatorId,
        settlementKey: kstMonthKey(),
        entryType: { notIn: ['PAYOUT', 'PAYOUT_WITHHOLDING'] },
      },
      _sum: { amount: true },
    }),
    getSettlementSummary(creatorId),
    prisma.youTubeConnection.findUnique({
      where: { creatorId },
      select: { status: true, channelTitle: true, lastError: true },
    }),
    prisma.streamChannel.findUnique({
      where: { creatorId },
      select: { live: true, ingestUrl: true, keys: { where: { status: 'ACTIVE' }, select: { id: true } } },
    }),
    prisma.creatorMoNumber.findFirst({
      where: { creatorId },
      orderBy: { assignedAt: 'desc' },
      select: { phoneNumber: true, keyword: true, mode: true, status: true },
    }),
    prisma.donation.findMany({
      where: { creatorId },
      orderBy: { receivedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        transactionNo: true,
        displayName: true,
        message: true,
        amount: true,
        status: true,
        receivedAt: true,
        anonymous: true,
      },
    }),
  ]);

  const ytConnected = youtube?.status === 'CONNECTED';
  const streamReady = Boolean(stream && stream.keys.length > 0);
  const moAssigned = moNumber?.status === 'ASSIGNED';

  return (
    <>
      <PageHeader title="대시보드" description="오늘 들어온 문자후원과 연동 상태를 한눈에 확인합니다. (KST 기준)" />

      <div className="space-y-5">
        <Notice tone="warning" title="현재 mock 모드로 동작합니다">
          결제(PG), 문자 수신·발송(MO/MT), 유튜브 채팅 전송은 모두 mock 어댑터로 처리됩니다. 화면에 표시되는 결제
          승인과 전송 성공은 실제 금융 거래·실제 유튜브 전송이 아닙니다. 실연동은 금융사 및 문자 사업자 계약, 구글
          OAuth 심사 완료 후 전환됩니다.
        </Notice>

        <section>
          <SectionTitle title="오늘 현황" description="KST 기준 오늘 0시부터의 집계입니다." />
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <StatTile label="오늘 후원금" value={formatWon(todayAmount._sum.amount ?? 0n)} tone="brand" />
            <StatTile label="오늘 문자 수신" value={`${formatNumber(todayMessages)}건`} />
            <StatTile label="결제 성공" value={`${formatNumber(todaySuccess)}건`} tone="success" />
            <StatTile
              label="결제 실패"
              value={`${formatNumber(todayFailed)}건`}
              tone={todayFailed > 0 ? 'danger' : 'neutral'}
            />
          </div>
        </section>

        <section>
          <SectionTitle title="정산 현황" description="정산 원장 기준 금액입니다." />
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <StatTile
              label="이번 달 예상 정산금"
              value={formatWon(monthLedger._sum.amount ?? 0n)}
              sub={`${kstMonthKey()} 원장 합계`}
            />
            <StatTile label="정산 가능 금액" value={formatWon(summary.available)} tone="brand" />
            <StatTile label="정산 보류금" value={formatWon(summary.pending)} sub="요청 검토 중" />
            <StatTile label="정산 완료금" value={formatWon(summary.totalPaid)} />
          </div>
        </section>

        <section>
          <SectionTitle title="연동 상태" description="연동이 완료되지 않으면 후원 메시지가 방송에 표시되지 않습니다." />
          <div className="grid gap-2.5 lg:grid-cols-3">
            <StatusCard
              title="유튜브 연동"
              ok={ytConnected}
              value={
                ytConnected
                  ? (youtube?.channelTitle ?? '연결됨')
                  : youtube
                    ? '연결 상태 확인 필요'
                    : '연결되지 않음'
              }
              note={youtube?.lastError ?? undefined}
              href="/studio/youtube"
              linkLabel={ytConnected ? '연동 관리' : '채널 연결하기'}
            />
            <StatusCard
              title="자체 방송"
              ok={streamReady}
              value={streamReady ? (stream?.live ? '방송 중' : '스트림 키 발급됨') : '스트림 키 없음'}
              note={streamReady ? stream?.ingestUrl : undefined}
              href="/studio/stream"
              linkLabel={streamReady ? '방송 설정' : '스트림 키 발급'}
            />
            <StatusCard
              title="MO 수신번호"
              ok={moAssigned}
              value={
                moNumber
                  ? `${moNumber.phoneNumber}${moNumber.keyword ? ` (${moNumber.keyword})` : ''}`
                  : '배정된 번호 없음'
              }
              note={
                moNumber
                  ? `${moNumberStatusLabel[moNumber.status].text} · ${moNumber.mode === 'DEDICATED' ? '전용번호' : '대표번호+키워드'}`
                  : '통합 관리자에게 번호 배정을 요청해 주세요.'
              }
              href="/studio/settings"
              linkLabel="후원 설정 보기"
            />
          </div>
        </section>

        <section>
          <SectionTitle
            title="최근 후원 메시지"
            description="최근 수신된 10건입니다."
            action={
              <LinkButton href="/studio/donations" variant="secondary" size="sm">
                전체 보기
              </LinkButton>
            }
          />
          {recent.length === 0 ? (
            <EmptyState title="아직 후원 내역이 없습니다" description="후원자가 문자를 보내면 여기에 표시됩니다." />
          ) : (
            <Card padded={false}>
              <ul>
                {recent.map((d) => {
                  const label = donationStatusLabel[d.status];
                  return (
                    <li key={d.id} className="border-b border-ink-100 px-4 py-3 last:border-0">
                      <Link href={`/studio/donations/${d.id}`} className="block">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[14px] font-bold text-ink-900">
                                {d.anonymous ? '익명의 후원자' : d.displayName}
                              </span>
                              <Badge tone={label.tone}>{label.text}</Badge>
                            </div>
                            <p className="mt-1 flex items-start gap-1.5 text-[13px] leading-relaxed text-ink-500">
                              <MessageSquareText size={15} strokeWidth={1.6} className="mt-0.5 shrink-0 text-ink-300" />
                              <span className="line-clamp-2">{d.message || '(내용 없음)'}</span>
                            </p>
                            <p className="mt-1 text-[11.5px] text-ink-300">
                              {d.transactionNo} · {formatKst(d.receivedAt, false)}
                            </p>
                          </div>
                          <span className="shrink-0 text-[15px] font-extrabold tabular-nums text-brand-600">
                            {formatWon(d.amount)}
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </section>
      </div>
    </>
  );
}

function StatusCard({
  title,
  ok,
  value,
  note,
  href,
  linkLabel,
}: {
  title: string;
  ok: boolean;
  value: string;
  note?: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-2">
        <CardTitle>{title}</CardTitle>
        <Badge tone={ok ? 'success' : 'warning'}>
          <span className="inline-flex items-center gap-1">
            {ok ? <CircleCheck size={13} strokeWidth={1.7} /> : <CircleAlert size={13} strokeWidth={1.7} />}
            {ok ? '정상' : '설정 필요'}
          </span>
        </Badge>
      </div>
      <p className="text-[14px] font-semibold text-ink-900">{value}</p>
      {note ? <p className="mt-1 break-all text-[12px] leading-relaxed text-ink-400">{note}</p> : null}
      <div className="mt-3">
        <LinkButton href={href} variant="secondary" size="sm">
          {linkLabel}
        </LinkButton>
      </div>
    </Card>
  );
}
