import Link from 'next/link';
import { PageHeader } from '@/components/layout/console-shell';
import { Badge, EmptyState, Notice, SectionTitle, StatTile, Table, Td, Th } from '@/components/ui';
import { ActionButton } from '@/components/admin/action-form';
import { revokeStreamKey } from '@/app/actions/admin/broadcast';
import { prisma } from '@/server/db';
import { env } from '@/lib/env';
import { formatNumber } from '@/lib/money';
import { formatKst } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

export default async function AdminStreamsPage() {
  const [channels, activeKeys, revokedKeys] = await Promise.all([
    prisma.streamChannel.findMany({
      orderBy: [{ live: 'desc' }, { updatedAt: 'desc' }],
      select: {
        id: true, creatorId: true, ingestUrl: true, playbackUrl: true, live: true,
        lastLiveAt: true, simulcast: true, createdAt: true, updatedAt: true,
        creator: { select: { id: true, displayName: true, code: true, status: true } },
        keys: {
          orderBy: { issuedAt: 'desc' },
          select: { id: true, keyMasked: true, status: true, issuedAt: true, revokedAt: true },
        },
      },
    }),
    prisma.streamKey.count({ where: { status: 'ACTIVE' } }),
    prisma.streamKey.count({ where: { status: 'REVOKED' } }),
  ]);

  const liveCount = channels.filter((c) => c.live).length;

  return (
    <>
      <PageHeader
        title="방송·스트림 관리"
        description="스트림 키 원문은 저장하지 않습니다. 해시와 마스킹 값만 보관하며 관리자 화면에서도 원문을 볼 수 없습니다."
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatTile label="채널 수" value={formatNumber(channels.length)} />
        <StatTile label="현재 라이브" value={formatNumber(liveCount)} tone={liveCount > 0 ? 'success' : 'neutral'} />
        <StatTile label="활성 키" value={formatNumber(activeKeys)} tone="brand" />
        <StatTile label="폐기 키" value={formatNumber(revokedKeys)} />
      </div>

      {env.stream.provider === 'mock' ? (
        <Notice tone="warning" title="스트리밍 어댑터가 mock 으로 동작 중입니다">
          실제 인제스트 서버와 통신하지 않습니다. 아래 인제스트/재생 주소는 환경변수 기반 예시 값이며, 실제 CDN 계약
          이후 어댑터를 교체해야 합니다.
        </Notice>
      ) : null}

      <div className="mt-5">
        <SectionTitle title="채널 목록" />
        {channels.length === 0 ? (
          <EmptyState title="등록된 스트림 채널이 없습니다" />
        ) : (
          <div className="space-y-4">
            {channels.map((c) => (
              <div key={c.id} className="rounded-2xl border border-ink-100 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Link href={`/admin/creators/${c.creator.id}`} className="text-[15px] font-bold text-brand-600">
                        {c.creator.displayName}
                      </Link>
                      <Badge tone={c.live ? 'success' : 'neutral'}>{c.live ? '라이브' : '오프라인'}</Badge>
                      {c.simulcast ? <Badge tone="brand">동시송출</Badge> : null}
                    </div>
                    <p className="mt-1 text-[12px] text-ink-400">
                      코드 {c.creator.code} · 최근 라이브 {formatKst(c.lastLiveAt, false)}
                    </p>
                  </div>
                  <div className="text-right text-[11px] text-ink-400">
                    <p className="font-mono break-all">{c.ingestUrl}</p>
                    {c.playbackUrl ? <p className="font-mono break-all">{c.playbackUrl}</p> : null}
                  </div>
                </div>

                <div className="mt-3">
                  {c.keys.length === 0 ? (
                    <p className="text-[13px] text-ink-400">발급된 스트림 키가 없습니다.</p>
                  ) : (
                    <Table className="min-w-0">
                      <thead>
                        <tr>
                          <Th>키 (마스킹)</Th>
                          <Th>상태</Th>
                          <Th>발급</Th>
                          <Th>폐기</Th>
                          <Th>처리</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.keys.map((k) => (
                          <tr key={k.id}>
                            <Td className="font-mono text-[12px]">{k.keyMasked}</Td>
                            <Td>
                              <Badge tone={k.status === 'ACTIVE' ? 'success' : 'neutral'}>
                                {k.status === 'ACTIVE' ? '활성' : '폐기'}
                              </Badge>
                            </Td>
                            <Td className="whitespace-nowrap">{formatKst(k.issuedAt, false)}</Td>
                            <Td className="whitespace-nowrap">{formatKst(k.revokedAt, false)}</Td>
                            <Td>
                              {k.status === 'ACTIVE' ? (
                                <ActionButton
                                  action={revokeStreamKey}
                                  values={{ keyId: k.id }}
                                  label="키 강제 폐기"
                                  variant="danger"
                                  confirm="이 스트림 키를 즉시 폐기합니다. 송출 중이라면 방송이 끊길 수 있습니다."
                                />
                              ) : (
                                <span className="text-[12px] text-ink-300">-</span>
                              )}
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5">
        <Notice tone="neutral" title="키 폐기 원칙">
          유출이 의심되면 즉시 폐기하고 크리에이터에게 재발급을 안내하세요. 폐기 이력은 감사로그에 기록되며, 폐기된
          키는 재사용할 수 없습니다.
        </Notice>
      </div>
    </>
  );
}
