import { Badge, Card, CardTitle, DataRow, EmptyState, LinkButton, Notice, SectionTitle, StatTile, Table, Td, Th } from '@/components/ui';
import { PageHeader } from '@/components/layout/console-shell';
import { ActionForm } from '@/components/studio/action-form';
import { one, type SearchParamsRecord } from '@/components/studio/shared';
import { disconnectYouTubeAction, refreshYouTubeBroadcastAction } from '@/app/actions/studio';
import { requireCreator } from '@/server/auth';
import { prisma } from '@/server/db';
import { getYouTubeQuotaUsage } from '@/server/services/broadcast-dispatch';
import { formatChatMessage, getYouTubeAdapter } from '@/server/adapters/youtube';
import { tokenHash } from '@/lib/crypto';
import { formatNumber } from '@/lib/money';
import { formatKst } from '@/lib/datetime';
import { deliveryStatusLabel } from '@/lib/labels';

export const dynamic = 'force-dynamic';

const CONNECTION_LABEL = {
  CONNECTED: { text: '연결됨', tone: 'success' as const },
  EXPIRED: { text: '토큰 만료', tone: 'warning' as const },
  REVOKED: { text: '연결 해제', tone: 'neutral' as const },
  ERROR: { text: '오류', tone: 'danger' as const },
};

const CALLBACK_MESSAGE: Record<string, { tone: 'success' | 'warning' | 'danger'; text: string }> = {
  connected: { tone: 'success', text: '유튜브 채널을 연결했습니다.' },
  denied: { tone: 'warning', text: '채널 연결 동의가 거부되었습니다.' },
  invalid: { tone: 'danger', text: '인증 응답이 올바르지 않습니다. 다시 시도해 주세요.' },
  state_mismatch: { tone: 'danger', text: '요청 검증에 실패했습니다(state 불일치). 다시 시도해 주세요.' },
  token_failed: { tone: 'danger', text: '액세스 토큰 발급에 실패했습니다.' },
  channel_failed: { tone: 'danger', text: '채널 정보 조회에 실패했습니다.' },
  error: { tone: 'danger', text: '연결 처리 중 오류가 발생했습니다.' },
};

export default async function StudioYouTubePage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  const { creatorId } = await requireCreator();
  const sp = await searchParams;
  const callback = CALLBACK_MESSAGE[one(sp.youtube)];

  const [connection, broadcast, quota, deliveries] = await Promise.all([
    prisma.youTubeConnection.findUnique({ where: { creatorId } }),
    prisma.youTubeBroadcast.findFirst({ where: { creatorId }, orderBy: { detectedAt: 'desc' } }),
    getYouTubeQuotaUsage(),
    prisma.youTubeChatDelivery.findMany({
      where: { donation: { creatorId } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        status: true,
        attempts: true,
        liveChatId: true,
        quotaUnits: true,
        errorCode: true,
        errorMessage: true,
        sentAt: true,
        createdAt: true,
        donation: { select: { id: true, transactionNo: true, displayName: true } },
      },
    }),
  ]);

  let authUrl: string | null = null;
  let adapterMode = 'mock';
  let adapterError: string | null = null;
  try {
    const adapter = getYouTubeAdapter();
    adapterMode = adapter.info().mode;
    authUrl = adapter.getAuthUrl(`${creatorId}.${tokenHash(creatorId)}`);
  } catch (e) {
    adapterError = (e as Error).message;
  }

  const connected = connection?.status === 'CONNECTED';
  const connLabel = connection ? CONNECTION_LABEL[connection.status] : null;

  const preview = formatChatMessage({
    donorName: '홍길동',
    amount: 3000n,
    message: '오늘 방송 재미있어요',
  });

  const quotaRatio = quota.total > 0 ? Math.min(100, Math.round((quota.used / quota.total) * 100)) : 0;
  const quotaTone = quotaRatio >= 80 ? 'danger' : quotaRatio >= 50 ? 'warning' : 'success';

  return (
    <>
      <PageHeader title="유튜브 연동" description="후원 메시지를 진행 중인 라이브 방송 채팅에 등록합니다." />

      <div className="space-y-5">
        {callback ? <Notice tone={callback.tone}>{callback.text}</Notice> : null}

        <Notice tone="warning" title={`현재 유튜브 어댑터는 ${adapterMode} 모드입니다`}>
          실제 구글 계정과 연결되지 않으며, 채팅 전송도 실제로 이루어지지 않습니다. 구글 OAuth 클라이언트 승인과 민감
          스코프 동의화면 검증이 완료되면 실연동으로 전환됩니다.
          {adapterError ? <span className="mt-1 block text-danger-500">{adapterError}</span> : null}
        </Notice>

        <section>
          <SectionTitle title="연결 상태" />
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <CardTitle>{connection?.channelTitle ?? '연결된 채널 없음'}</CardTitle>
              {connLabel ? <Badge tone={connLabel.tone}>{connLabel.text}</Badge> : <Badge tone="neutral">미연결</Badge>}
            </div>

            {connection ? (
              <div>
                <DataRow label="채널 ID" value={<span className="font-mono text-[12px]">{connection.channelId}</span>} />
                <DataRow label="권한 스코프" value={<span className="break-all font-mono text-[11.5px]">{connection.scope}</span>} />
                <DataRow label="토큰 만료 시각" value={formatKst(connection.expiresAt)} />
                <DataRow label="마지막 확인" value={formatKst(connection.lastCheckedAt)} />
                <DataRow
                  label="마지막 오류"
                  value={connection.lastError ? <span className="text-danger-500">{connection.lastError}</span> : '없음'}
                />
              </div>
            ) : (
              <p className="text-[13px] leading-relaxed text-ink-500">
                채널을 연결하면 결제가 완료된 후원 메시지가 라이브 채팅에 자동으로 등록됩니다.
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-start gap-2">
              {authUrl ? (
                <LinkButton href={authUrl} prefetch={false} size="sm">
                  {connected ? '채널 다시 연결' : '채널 연결'}
                </LinkButton>
              ) : null}
              {connected ? (
                <ActionForm
                  action={disconnectYouTubeAction}
                  submitLabel="연결 해제"
                  variant="secondary"
                  size="sm"
                  confirmMessage="유튜브 채널 연결을 해제하시겠습니까? 이후 후원 메시지가 라이브 채팅에 등록되지 않습니다."
                />
              ) : null}
            </div>
          </Card>
        </section>

        <section>
          <SectionTitle title="할당량" description="유튜브 Data API 일일 할당량 사용 현황입니다. (KST 기준 매일 초기화)" />
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <StatTile label="사용량" value={formatNumber(quota.used)} sub={`전체 ${formatNumber(quota.total)} units`} tone={quotaTone} />
            <StatTile label="사용률" value={`${quotaRatio}%`} tone={quotaTone} />
            <StatTile label="1건당 비용" value={`${formatNumber(quota.insertCost)} units`} />
            <StatTile label="남은 전송 가능 건수" value={`${formatNumber(quota.remainingMessages)}건`} tone="brand" />
          </div>
          <div className="mt-2.5">
            <Notice tone="warning" title="라이브 채팅 등록은 할당량 비용이 큽니다">
              라이브 채팅 등록은 할당량 비용이 커서 증설 신청 전에는 하루 전송 건수가 제한됩니다. 할당량을 모두 사용하면
              이후 후원의 채팅 전송은 실패로 기록되며, 결제와 오버레이 송출에는 영향을 주지 않습니다.
            </Notice>
          </div>
        </section>

        <section>
          <SectionTitle title="현재 라이브 방송" description="연결된 채널에서 진행 중인 방송을 조회합니다." />
          <Card>
            {broadcast ? (
              <div className="mb-3">
                <DataRow label="방송 제목" value={broadcast.title ?? '-'} />
                <DataRow label="방송 ID" value={<span className="font-mono text-[12px]">{broadcast.broadcastId}</span>} />
                <DataRow label="라이브 채팅 ID" value={<span className="font-mono text-[12px]">{broadcast.liveChatId ?? '-'}</span>} />
                <DataRow label="채팅 활성 여부" value={<Badge tone={broadcast.chatEnabled ? 'success' : 'danger'}>{broadcast.chatEnabled ? '활성' : '비활성'}</Badge>} />
                <DataRow label="상태" value={broadcast.lifeCycle ?? '-'} />
                <DataRow label="시작 시각" value={formatKst(broadcast.startedAt)} />
                <DataRow label="마지막 조회" value={formatKst(broadcast.detectedAt)} />
              </div>
            ) : (
              <p className="mb-3 text-[13px] leading-relaxed text-ink-500">
                아직 조회된 라이브 방송이 없습니다. 방송을 시작한 뒤 아래 버튼으로 조회해 주세요.
              </p>
            )}
            <ActionForm
              action={refreshYouTubeBroadcastAction}
              submitLabel="현재 라이브 방송 조회"
              variant="secondary"
              size="sm"
            />
          </Card>
        </section>

        <section>
          <SectionTitle title="전송 메시지 미리보기" />
          <Card>
            <p className="rounded-xl bg-ink-50 px-4 py-3 text-[13.5px] leading-relaxed text-ink-900">{preview}</p>
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-500">
              유튜브 공식 슈퍼챗이 아니며 연결된 채널 계정으로 표시됩니다. 후원 금액과 표시명은 토네이도에서 결제된
              값이며, 유튜브에는 결제 정보가 전달되지 않습니다.
            </p>
          </Card>
        </section>

        <section>
          <SectionTitle title="최근 전송 결과" description="최근 20건입니다." />
          {deliveries.length === 0 ? (
            <EmptyState title="전송 내역이 없습니다" description="결제가 완료된 후원이 발생하면 여기에 기록됩니다." />
          ) : (
            <Table className="min-w-full">
              <thead>
                <tr>
                  <Th>시각</Th>
                  <Th>거래번호</Th>
                  <Th>표시명</Th>
                  <Th>상태</Th>
                  <Th>시도</Th>
                  <Th>할당량</Th>
                  <Th>오류</Th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => {
                  const tone = deliveryStatusLabel[d.status];
                  return (
                    <tr key={d.id}>
                      <Td className="whitespace-nowrap tabular-nums">{formatKst(d.sentAt ?? d.createdAt, false)}</Td>
                      <Td className="font-mono text-[12px]">{d.donation.transactionNo}</Td>
                      <Td className="whitespace-nowrap">{d.donation.displayName}</Td>
                      <Td>
                        <Badge tone={tone.tone}>{tone.text}</Badge>
                      </Td>
                      <Td className="tabular-nums">{d.attempts}</Td>
                      <Td className="tabular-nums">{d.quotaUnits}</Td>
                      <Td>{d.errorCode ? `${d.errorCode} ${d.errorMessage ?? ''}`.trim() : '-'}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </section>
      </div>
    </>
  );
}
