import Link from 'next/link';
import {
  CircleAlert,
  CircleCheck,
  MessageSquareText,
  ChevronRight,
  Info,
} from 'lucide-react';
import { Badge, Card, EmptyState, LinkButton } from '@/components/ui';
import { PageHeader } from '@/components/layout/console-shell';
import { BannerStrip } from '@/components/public/banner-strip';
import { PAID_STATUSES } from '@/components/studio/shared';
import { requireCreator } from '@/server/auth';
import { prisma } from '@/server/db';
import { getSettlementSummary } from '@/server/services/settlement';
import { formatNumber, formatWon } from '@/lib/money';
import { formatKst, kstMonthKey, kstStartOfDay } from '@/lib/datetime';
import { donationStatusLabel, moNumberStatusLabel } from '@/lib/labels';

export const dynamic = 'force-dynamic';

/**
 * 크리에이터 대시보드.
 * 카드가 많아 어수선해지지 않도록 화면을 네 덩어리로만 나눈다.
 *   1) 핵심 수치 (오늘 + 정산)
 *   2) 연동 상태 (카드 대신 한 줄 목록)
 *   3) 최근 후원 메시지
 * 세부 관리 진입은 각 줄의 링크와 좌측 메뉴로 처리한다.
 */
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
      take: 8,
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

  const links = [
    {
      label: '유튜브 채널',
      ok: ytConnected,
      value: ytConnected ? (youtube?.channelTitle ?? '연결됨') : youtube ? '연결 상태 확인 필요' : '연결되지 않음',
      href: '/studio/youtube',
    },
    {
      label: 'MO 수신번호',
      ok: moAssigned,
      value: moNumber
        ? `${moNumber.phoneNumber}${moNumber.keyword ? ` (${moNumber.keyword})` : ''} · ${moNumberStatusLabel[moNumber.status].text}`
        : '배정된 번호 없음',
      href: '/studio/messages',
    },
    {
      label: '자체 방송',
      ok: streamReady,
      value: streamReady ? (stream?.live ? '방송 중' : '스트림 키 발급됨') : '스트림 키 없음',
      href: '/studio/overlay#stream',
    },
  ];

  // 연동 미완료 항목이 있으면 최상단에 '다음 할 일' 로 안내한다 (온보딩 완주 유도)
  const nextStep = links.find((l) => !l.ok) ?? null;

  return (
    <>
      <PageHeader
        title="대시보드"
        description="오늘 들어온 문자후원과 연동 상태를 한눈에 확인합니다. (KST 기준)"
        action={
          <LinkButton href="/studio/donations" variant="secondary" size="sm">
            후원 내역 전체 보기
          </LinkButton>
        }
      />

      <div className="space-y-4">
        <BannerStrip position="CONSOLE_TOP" />

        {nextStep ? (
          <Link
            href={nextStep.href}
            className="flex items-center justify-between gap-3 rounded-2xl border border-brand-300 bg-brand-100 px-4 py-3.5 transition-transform hover:-translate-y-0.5"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <CircleAlert size={18} strokeWidth={1.8} className="shrink-0 text-brand-800" />
              <span className="min-w-0">
                <span className="block text-[13.5px] font-extrabold text-ink-900">
                  다음 할 일: {nextStep.label} 설정
                </span>
                <span className="block truncate text-[12px] text-ink-700">
                  {nextStep.value} — 설정을 마쳐야 후원 메시지가 방송에 표시됩니다.
                </span>
              </span>
            </span>
            <ChevronRight size={16} strokeWidth={1.8} className="shrink-0 text-brand-800" />
          </Link>
        ) : null}

        {/* mock 안내: 큰 박스 대신 한 줄 띠 */}
        <p className="flex items-start gap-2 rounded-xl border border-warning-500/25 bg-warning-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-700">
          <Info size={15} strokeWidth={1.8} className="mt-0.5 shrink-0 text-warning-500" />
          <span>
            현재 mock 모드입니다. 결제·문자·유튜브 전송이 모두 모의 처리되며, 화면의 성공 표시는 실제 금융 거래나 실제
            유튜브 전송이 아닙니다.
          </span>
        </p>

        {/* 1) 핵심 수치 — 카드 8개 대신 한 판에 정리 */}
        <Card padded={false} className="overflow-hidden">
          <div className="grid grid-cols-2 divide-ink-100 lg:grid-cols-4 lg:divide-x">
            <Metric label="오늘 후원금" value={formatWon(todayAmount._sum.amount ?? 0n)} accent />
            <Metric label="오늘 문자 수신" value={`${formatNumber(todayMessages)}건`} />
            <Metric
              label="결제 성공"
              value={`${formatNumber(todaySuccess)}건`}
              sub={todayFailed > 0 ? `실패 ${formatNumber(todayFailed)}건` : '실패 없음'}
              subTone={todayFailed > 0 ? 'danger' : 'muted'}
            />
            <Metric label="이번 달 예상 정산금" value={formatWon(monthLedger._sum.amount ?? 0n)} sub={kstMonthKey()} />
          </div>

          <div className="grid grid-cols-3 border-t border-ink-100 bg-ink-50/60 divide-x divide-ink-100">
            <MiniMetric label="정산 가능" value={formatWon(summary.available)} accent />
            <MiniMetric label="정산 보류" value={formatWon(summary.pending)} />
            <MiniMetric label="정산 완료" value={formatWon(summary.totalPaid)} />
          </div>

          <Link
            href="/studio/settlement"
            className="flex items-center justify-between border-t border-ink-100 px-4 py-2.5 text-[12.5px] font-semibold text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-900"
          >
            정산 관리로 이동
            <ChevronRight size={15} strokeWidth={1.8} />
          </Link>
        </Card>

        {/* 2) 연동 상태 — 카드 3개 대신 목록 한 장 */}
        <Card padded={false}>
          <p className="border-b border-ink-100 px-4 py-3 text-[13px] font-bold text-ink-900">
            연동 상태
            <span className="ml-2 text-[11.5px] font-medium text-ink-400">
              연동이 끝나야 후원 메시지가 방송에 표시됩니다
            </span>
          </p>
          <ul>
            {links.map((l) => (
              <li key={l.href} className="border-b border-ink-100 last:border-0">
                <Link
                  href={l.href}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-ink-50"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className={l.ok ? 'text-success-500' : 'text-warning-500'}>
                      {l.ok ? <CircleCheck size={16} strokeWidth={1.8} /> : <CircleAlert size={16} strokeWidth={1.8} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-bold text-ink-900">{l.label}</span>
                      <span className="block truncate text-[12px] text-ink-500">{l.value}</span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge tone={l.ok ? 'success' : 'warning'}>{l.ok ? '정상' : '설정 필요'}</Badge>
                    <ChevronRight size={15} strokeWidth={1.8} className="text-ink-300" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        {/* 3) 최근 후원 메시지 */}
        <Card padded={false}>
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <p className="text-[13px] font-bold text-ink-900">최근 후원 메시지</p>
            <Link href="/studio/messages" className="text-[12.5px] font-semibold text-brand-700 hover:underline">
              문자 관리
            </Link>
          </div>
          {recent.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="아직 후원 내역이 없습니다"
                description="방송 화면에 후원 번호를 안내하면 후원이 시작됩니다. 안내 문구는 문자 관리에서 복사할 수 있습니다."
                action={
                  <LinkButton href="/studio/messages" variant="secondary" size="sm">
                    후원 번호 안내 문구 복사하러 가기
                  </LinkButton>
                }
              />
            </div>
          ) : (
            <ul>
              {recent.map((d) => {
                const label = donationStatusLabel[d.status];
                return (
                  <li key={d.id} className="border-b border-ink-100 last:border-0">
                    <Link href={`/studio/donations/${d.id}`} className="block px-4 py-3 transition-colors hover:bg-ink-50">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[13.5px] font-bold text-ink-900">
                              {d.anonymous ? '익명의 후원자' : d.displayName}
                            </span>
                            <Badge tone={label.tone}>{label.text}</Badge>
                          </div>
                          <p className="mt-1 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-ink-500">
                            <MessageSquareText size={14} strokeWidth={1.6} className="mt-0.5 shrink-0 text-ink-300" />
                            <span className="line-clamp-1">{d.message || '(내용 없음)'}</span>
                          </p>
                          <p className="mt-1 text-[11px] text-ink-300">
                            {d.transactionNo} · {formatKst(d.receivedAt, false)}
                          </p>
                        </div>
                        <span className="shrink-0 text-[14.5px] font-extrabold tabular-nums text-ink-900">
                          {formatWon(d.amount)}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function Metric({
  label,
  value,
  sub,
  subTone = 'muted',
  accent = false,
}: {
  label: string;
  value: string;
  sub?: string;
  subTone?: 'muted' | 'danger';
  accent?: boolean;
}) {
  return (
    <div className="border-b border-ink-100 px-4 py-4 last:border-b-0 lg:border-b-0">
      <p className="text-[11.5px] font-bold text-ink-400">{label}</p>
      <p
        className={
          accent
            ? 'mt-1.5 text-[22px] font-black tracking-[-0.035em] tabular-nums text-brand-700'
            : 'mt-1.5 text-[22px] font-black tracking-[-0.035em] tabular-nums text-ink-900'
        }
      >
        {value}
      </p>
      {sub ? (
        <p className={subTone === 'danger' ? 'mt-0.5 text-[11.5px] text-danger-500' : 'mt-0.5 text-[11.5px] text-ink-400'}>
          {sub}
        </p>
      ) : null}
    </div>
  );
}

function MiniMetric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="px-4 py-3">
      <p className="text-[11px] font-semibold text-ink-400">{label}</p>
      <p
        className={
          accent
            ? 'mt-0.5 text-[15px] font-extrabold tabular-nums text-brand-700'
            : 'mt-0.5 text-[15px] font-extrabold tabular-nums text-ink-900'
        }
      >
        {value}
      </p>
    </div>
  );
}
