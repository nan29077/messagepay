import { Badge, Card, CardTitle, DataRow, EmptyState, Notice, SectionTitle, Table, Td, Th } from '@/components/ui';
import { PageHeader } from '@/components/layout/console-shell';
import { ActionForm } from '@/components/studio/action-form';
import { CopyField } from '@/components/studio/copy';
import { reissueStreamKeyAction } from '@/app/actions/studio';
import { requireCreator } from '@/server/auth';
import { prisma } from '@/server/db';
import { env } from '@/lib/env';
import { formatKst } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

export default async function StudioStreamPage() {
  const { creatorId } = await requireCreator();

  const channel = await prisma.streamChannel.findUnique({
    where: { creatorId },
    include: { keys: { orderBy: { issuedAt: 'desc' }, take: 10 } },
  });

  const activeKey = channel?.keys.find((k) => k.status === 'ACTIVE') ?? null;
  const ingestUrl = channel?.ingestUrl ?? env.stream.ingestBase;
  const playbackUrl = channel?.playbackUrl ?? `${env.stream.playbackBase}/${creatorId}.m3u8`;

  return (
    <>
      <PageHeader title="자체 방송" description="토네이도 자체 방송용 RTMPS 송출 정보를 관리합니다." />

      <div className="space-y-5">
        <Notice tone="warning" title="자체 방송은 4단계 기능입니다">
          자체 방송(RTMPS Ingest/HLS)은 별도 미디어 인프라가 필요한 4단계 기능으로, 현재는 키 관리만 제공합니다. 아래
          주소로 송출해도 실제 방송은 재생되지 않으며, 스트림 어댑터는 {env.stream.provider} 모드로 동작합니다. 지금은
          유튜브 라이브와 오버레이 조합으로 방송해 주세요.
        </Notice>

        <section>
          <SectionTitle title="송출 정보" />
          <div className="grid gap-2.5 lg:grid-cols-2">
            <Card>
              <CardTitle>RTMPS 서버</CardTitle>
              <div className="mt-3 space-y-3">
                <CopyField label="서버 주소" value={ingestUrl} hint="방송 프로그램의 사용자 지정 서버 주소에 입력합니다." />
                <CopyField label="재생 URL (HLS)" value={playbackUrl} hint="미디어 인프라 구축 후 동작합니다." />
              </div>
            </Card>

            <Card>
              <CardTitle>스트림 키</CardTitle>
              <div className="mt-2">
                <DataRow
                  label="현재 키"
                  value={
                    activeKey ? (
                      <span className="font-mono text-[12px]">{activeKey.keyMasked}</span>
                    ) : (
                      <Badge tone="warning">발급된 키 없음</Badge>
                    )
                  }
                />
                <DataRow label="발급 시각" value={formatKst(activeKey?.issuedAt)} />
                <DataRow label="방송 상태" value={channel?.live ? <Badge tone="success">방송 중</Badge> : <Badge tone="neutral">대기</Badge>} />
              </div>
              <div className="mb-3 mt-3">
                <Notice tone="danger" title="재발급하면 기존 키가 즉시 무효화됩니다">
                  스트림 키는 해시로만 저장되어 원문을 다시 확인할 수 없습니다. 새 키는 발급 직후 이 화면에서 한 번만
                  표시되니 바로 방송 프로그램에 등록해 주세요.
                </Notice>
              </div>
              <ActionForm
                action={reissueStreamKeyAction}
                submitLabel={activeKey ? '스트림 키 재발급' : '스트림 키 발급'}
                variant={activeKey ? 'danger' : 'primary'}
                confirmMessage="새 스트림 키를 발급하면 기존 키로는 송출할 수 없습니다. 계속할까요?"
              />
            </Card>
          </div>
        </section>

        <section>
          <SectionTitle title="키 발급 이력" description="최근 10건입니다. 폐기된 키는 송출에 사용할 수 없습니다." />
          {!channel || channel.keys.length === 0 ? (
            <EmptyState title="발급 이력이 없습니다" description="위에서 스트림 키를 발급해 주세요." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>키(마스킹)</Th>
                  <Th>상태</Th>
                  <Th>발급 시각</Th>
                  <Th>폐기 시각</Th>
                </tr>
              </thead>
              <tbody>
                {channel.keys.map((k) => (
                  <tr key={k.id}>
                    <Td className="font-mono text-[12px]">{k.keyMasked}</Td>
                    <Td>
                      <Badge tone={k.status === 'ACTIVE' ? 'success' : 'neutral'}>
                        {k.status === 'ACTIVE' ? '사용 중' : '폐기됨'}
                      </Badge>
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums">{formatKst(k.issuedAt)}</Td>
                    <Td className="whitespace-nowrap tabular-nums">{formatKst(k.revokedAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>
      </div>
    </>
  );
}
