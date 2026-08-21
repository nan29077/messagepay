import Link from 'next/link';
import { PageHeader } from '@/components/layout/console-shell';
import { Badge, Card, CardTitle, EmptyState, Notice, SectionTitle, Table, Td, Th } from '@/components/ui';
import { AdminField, AdminInput, AdminSelect, AdminTextarea } from '@/components/admin/controls';
import { ActionFormWithDetail } from '@/components/admin/action-form';
import { maskLinkTokens, shortId } from '@/components/admin/mask';
import { runMoSimulation } from '@/app/actions/admin/simulator';
import { prisma } from '@/server/db';
import { readMockOutbox } from '@/server/adapters/mt';
import { env, isLocal } from '@/lib/env';
import { maskPhone } from '@/lib/crypto';
import { formatWon } from '@/lib/money';
import { formatKst } from '@/lib/datetime';
import { moResultLabel, donationStatusLabel } from '@/lib/labels';

export const dynamic = 'force-dynamic';

export default async function AdminSimulatorPage() {
  // 로컬 개발 환경이 아니면 화면 자체를 차단한다.
  if (!isLocal) {
    return (
      <>
        <PageHeader title="MO 시뮬레이터" description="운영 환경에서는 사용할 수 없습니다." />
        <Notice tone="danger" title="운영 환경에서는 비활성화된 기능입니다">
          MO 시뮬레이터는 실제 후원 거래와 결제를 생성합니다. APP_ENV=prod 환경에서는 화면과 서버 액션이 모두
          차단됩니다. 검증이 필요하면 스테이징 환경을 사용하세요.
        </Notice>
      </>
    );
  }

  const [numbers, recent] = await Promise.all([
    prisma.creatorMoNumber.findMany({
      where: { status: 'ASSIGNED' },
      orderBy: { phoneNumber: 'asc' },
      select: {
        id: true, phoneNumber: true, keyword: true, mode: true,
        creator: { select: { id: true, displayName: true, code: true, donationAmount: true } },
      },
    }),
    prisma.moInboundMessage.findMany({
      orderBy: { receivedAt: 'desc' },
      take: 10,
      select: {
        id: true, providerMessageId: true, receivedNumber: true, phoneMasked: true, result: true,
        contentFiltered: true, receivedAt: true,
        creator: { select: { displayName: true } },
        donation: { select: { transactionNo: true, status: true, amount: true } },
      },
    }),
  ]);

  const outbox = readMockOutbox(15);

  return (
    <>
      <PageHeader
        title="MO 시뮬레이터"
        description="실제 MO 사업자 연동 전 수신 → 후원 → 결제 → 방송 흐름을 검증하는 개발·검수용 도구입니다."
      />

      <Notice tone="danger" title="운영 환경에서는 반드시 비활성화해야 합니다">
        이 도구는 실제 후원 거래와 결제(현재는 mock 결제)를 생성합니다. 현재 환경은 APP_ENV={env.appEnv},
        MO_PROVIDER={env.mo.provider}, PAYMENT_PROVIDER={env.payment.provider},
        SAFE_MODE={env.safety.safeMode ? '켜짐' : '꺼짐'} 입니다. APP_ENV=prod 로 배포되면 화면과 서버 액션이 모두
        차단됩니다.
      </Notice>

      {numbers.length === 0 ? (
        <div className="mt-4">
          <Notice tone="warning" title="배정된 MO 번호가 없습니다">
            시뮬레이션을 실행하려면 먼저{' '}
            <Link href="/admin/mo-numbers" className="font-semibold text-brand-700">
              MO 번호 관리
            </Link>
            에서 승인된 크리에이터에게 수신번호를 배정해야 합니다.
          </Notice>
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardTitle>수신 문자 시뮬레이션</CardTitle>
          <p className="mt-1 mb-3 text-[12px] leading-relaxed text-ink-400">
            mock MO 어댑터의 파서를 그대로 사용해 실제 수신 처리 로직을 실행합니다.
          </p>
          <ActionFormWithDetail
            action={runMoSimulation}
            submitLabel="시뮬레이션 실행"
            confirm="실제 후원 거래가 생성됩니다. 계속할까요?"
            detailLabels={{
              result: '처리 결과',
              donationStatus: '후원 상태',
              transactionNo: '거래번호',
              moMessageId: '수신 메시지 ID',
              providerMessageId: '사업자 메시지 ID',
              systemMessage: '시스템 메시지',
            }}
          >
            <AdminField label="수신번호 (배정된 MO 번호)">
              <AdminSelect name="to" defaultValue={numbers[0]?.phoneNumber ?? ''} required>
                {numbers.length === 0 ? <option value="">배정된 번호 없음</option> : null}
                {numbers.map((n) => (
                  <option key={n.id} value={n.phoneNumber}>
                    {n.phoneNumber}
                    {n.keyword ? ` (${n.keyword})` : ''} · {n.creator?.displayName ?? '미배정'}
                  </option>
                ))}
              </AdminSelect>
            </AdminField>
            <AdminField
              label="발신 휴대전화번호"
              hint="전화번호 기준 최초 MO에만 내통장결제 가입 링크가 발송되며, 가입 전 반복 MO에는 링크를 다시 보내지 않습니다."
            >
              <AdminInput name="from" placeholder="010-1234-5678" required />
            </AdminField>
            <AdminField
              label="문자 내용"
              hint="대표번호 공유 모드에서는 맨 앞에 키워드를 붙여야 크리에이터가 식별됩니다."
            >
              <AdminTextarea name="content" rows={4} placeholder="오늘 방송 재밌어요" required />
            </AdminField>
            <AdminField label="사업자 메시지 ID" hint="비우면 자동 생성됩니다. 같은 값을 재사용하면 중복으로 처리됩니다.">
              <AdminInput name="messageId" placeholder="자동 생성" />
            </AdminField>
          </ActionFormWithDetail>
        </Card>

        <div className="lg:col-span-2 space-y-4">
          <section>
            <SectionTitle title="배정된 수신번호" description="시뮬레이션에서 선택할 수 있는 번호입니다." />
            {numbers.length === 0 ? (
              <EmptyState title="배정된 MO 번호가 없습니다" />
            ) : (
              <Table className="min-w-0">
                <thead>
                  <tr>
                    <Th>번호</Th>
                    <Th>키워드</Th>
                    <Th>모드</Th>
                    <Th>크리에이터</Th>
                    <Th className="text-right">1건 후원금</Th>
                  </tr>
                </thead>
                <tbody>
                  {numbers.map((n) => (
                    <tr key={n.id}>
                      <Td className="font-mono text-[12px]">{n.phoneNumber}</Td>
                      <Td>{n.keyword ?? '-'}</Td>
                      <Td>{n.mode === 'DEDICATED' ? '전용번호' : '대표번호 공유'}</Td>
                      <Td>
                        {n.creator ? (
                          <Link href={`/admin/creators/${n.creator.id}`} className="font-semibold text-brand-700">
                            {n.creator.displayName}
                          </Link>
                        ) : (
                          '-'
                        )}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {n.creator ? formatWon(n.creator.donationAmount) : '-'}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </section>

          <section>
            <SectionTitle title="직후 발송된 모의 MT 문자" description="mock MT 발송함 최근 15건. 실제 문자는 발송되지 않습니다." />
            <Card>
              {outbox.length === 0 ? (
                <p className="text-[13px] text-ink-400">적재된 모의 발송 내역이 없습니다.</p>
              ) : (
                <div className="space-y-2">
                  {outbox.map((o) => (
                    <div key={o.id} className="rounded-xl border border-ink-100 bg-ink-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[12px] font-semibold text-ink-700">{maskPhone(o.to)}</span>
                        <span className="text-[11px] text-ink-400">
                          {formatKst(o.at, false)} · {shortId(o.id, 10, 4)}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-700">
                        {maskLinkTokens(o.text)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-3 text-[11px] leading-relaxed text-ink-400">
                보안링크 토큰 원문은 관리자 화면에 노출하지 않습니다. 링크 검증이 필요하면 서버 로그 또는 개발 환경의
                secure_link 테이블을 통해 확인하세요.
              </p>
            </Card>
          </section>
        </div>
      </div>

      <section className="mt-6">
        <SectionTitle title="최근 수신 문자 10건" description="시뮬레이션 결과를 포함한 전체 수신 이력입니다." />
        {recent.length === 0 ? (
          <EmptyState title="수신 이력이 없습니다" />
        ) : (
          <Table className="min-w-[900px]">
            <thead>
              <tr>
                <Th>수신 시각</Th>
                <Th>사업자 메시지 ID</Th>
                <Th>수신번호</Th>
                <Th>발신</Th>
                <Th>크리에이터</Th>
                <Th>결과</Th>
                <Th>필터링된 내용</Th>
                <Th>거래</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map((m) => (
                <tr key={m.id}>
                  <Td className="whitespace-nowrap">{formatKst(m.receivedAt, false)}</Td>
                  <Td className="font-mono text-[11px]">{shortId(m.providerMessageId, 10, 4)}</Td>
                  <Td className="font-mono text-[12px]">{m.receivedNumber}</Td>
                  <Td>{m.phoneMasked}</Td>
                  <Td>{m.creator?.displayName ?? '-'}</Td>
                  <Td>
                    <Badge tone={moResultLabel[m.result].tone}>{moResultLabel[m.result].text}</Badge>
                  </Td>
                  <Td className="max-w-[200px] break-words">{m.contentFiltered ?? '-'}</Td>
                  <Td>
                    {m.donation ? (
                      <>
                        <span className="block font-mono text-[11px]">{m.donation.transactionNo}</span>
                        <Badge tone={donationStatusLabel[m.donation.status].tone}>
                          {donationStatusLabel[m.donation.status].text}
                        </Badge>
                        <span className="mt-0.5 block text-[11px] text-ink-400">{formatWon(m.donation.amount)}</span>
                      </>
                    ) : (
                      '-'
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </>
  );
}
