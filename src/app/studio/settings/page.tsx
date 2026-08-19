import { notFound } from 'next/navigation';
import { Badge, Card, CardTitle, DataRow, Field, Input, Notice, SectionTitle } from '@/components/ui';
import { PageHeader } from '@/components/layout/console-shell';
import { ActionForm } from '@/components/studio/action-form';
import { CopyField } from '@/components/studio/copy';
import { updateDonationSettingsAction } from '@/app/actions/studio';
import { requireCreator } from '@/server/auth';
import { prisma } from '@/server/db';
import { resolvePolicy } from '@/server/services/limits';
import { env } from '@/lib/env';
import { formatWon } from '@/lib/money';
import { moNumberStatusLabel, paymentModeLabel } from '@/lib/labels';

export const dynamic = 'force-dynamic';

export default async function StudioSettingsPage() {
  const { creatorId } = await requireCreator();

  const [creator, moNumbers, policy] = await Promise.all([
    prisma.creatorProfile.findUnique({
      where: { id: creatorId },
      select: {
        code: true,
        displayName: true,
        donationAmount: true,
        minAmount: true,
        maxAmount: true,
        paymentMode: true,
      },
    }),
    prisma.creatorMoNumber.findMany({
      where: { creatorId },
      orderBy: { assignedAt: 'desc' },
      select: { id: true, phoneNumber: true, keyword: true, mode: true, status: true, assignedAt: true },
    }),
    resolvePolicy(creatorId, null),
  ]);

  if (!creator) notFound();

  const effectiveMode = creator.paymentMode ?? 'CONFIRM_LINK';
  const donationPageUrl = `${env.baseUrl}/c/${creator.code}`;

  return (
    <>
      <PageHeader title="후원 설정" description="문자 1건당 후원금과 수신번호, 후원 페이지 정보를 관리합니다." />

      <div className="space-y-5">
        <section>
          <SectionTitle title="문자 1건당 후원금" description="후원자가 문자 1건을 보낼 때 결제되는 금액입니다." />
          <Card>
            <ActionForm action={updateDonationSettingsAction} submitLabel="후원금 저장">
              <Field
                label="문자 1건당 후원금 (원)"
                hint={`설정 가능 범위: ${formatWon(creator.minAmount)} ~ ${formatWon(creator.maxAmount)}`}
              >
                <Input
                  name="donationAmount"
                  inputMode="numeric"
                  defaultValue={creator.donationAmount.toString()}
                  className="tabular-nums"
                />
              </Field>
            </ActionForm>

            <div className="mt-4">
              <DataRow label="현재 설정 금액" value={formatWon(creator.donationAmount)} />
              <DataRow label="전역 정책 1건 허용 범위" value={`${formatWon(policy.minAmount)} ~ ${formatWon(policy.maxAmount)}`} />
              <DataRow label="후원자 1인 1일 한도" value={formatWon(policy.donorDailyLimit)} />
              <DataRow label="내 채널 기준 후원자 1일 한도" value={formatWon(policy.perCreatorDailyLimit)} />
            </div>
          </Card>
        </section>

        <section>
          <SectionTitle title="결제 모드" description="결제 모드는 크리에이터가 변경할 수 없습니다." />
          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <CardTitle>{paymentModeLabel[effectiveMode]}</CardTitle>
              <Badge tone="neutral">읽기 전용</Badge>
            </div>
            <div className="mb-3">
              <DataRow label="확인형 (CONFIRM_LINK)" value={paymentModeLabel.CONFIRM_LINK} />
              <DataRow label="즉시형 (DIRECT_TRIGGER)" value={paymentModeLabel.DIRECT_TRIGGER} />
              <DataRow
                label="즉시형 허용 여부"
                value={
                  env.safety.allowDirectTrigger ? (
                    <Badge tone="success">플랫폼 허용</Badge>
                  ) : (
                    <Badge tone="warning">전체 비활성</Badge>
                  )
                }
              />
            </div>
            <Notice tone="warning" title="즉시형은 크리에이터가 켤 수 없습니다">
              즉시형(DIRECT_TRIGGER)은 금융사 서면승인 등록 후 통합 관리자만 활성화할 수 있습니다. 문자 수신 즉시
              출금이 일어나는 방식이므로, 서면승인 없이 사용하면 전자금융거래 관련 규정을 위반할 수 있습니다. 변경이
              필요하면 고객센터를 통해 신청해 주세요.
            </Notice>
          </Card>
        </section>

        <section>
          <SectionTitle title="MO 수신번호" description="후원자가 문자를 보내는 번호입니다. 배정과 변경은 통합 관리자가 처리합니다." />
          <Card>
            {moNumbers.length === 0 ? (
              <Notice tone="warning">
                배정된 수신번호가 없습니다. 번호가 배정되기 전에는 문자후원을 받을 수 없습니다. 고객센터로 배정을
                요청해 주세요.
              </Notice>
            ) : (
              <div className="space-y-3">
                {moNumbers.map((mo) => (
                  <div key={mo.id} className="rounded-xl border border-ink-100 px-3 py-2">
                    <DataRow label="수신번호" value={<span className="font-mono">{mo.phoneNumber}</span>} />
                    <DataRow
                      label="수신 방식"
                      value={mo.mode === 'DEDICATED' ? '전용번호 (문자 내용만 전송)' : '대표번호 + 키워드'}
                    />
                    <DataRow label="키워드" value={mo.keyword ? <span className="font-mono">{mo.keyword}</span> : '없음'} />
                    <DataRow
                      label="상태"
                      value={<Badge tone={moNumberStatusLabel[mo.status].tone}>{moNumberStatusLabel[mo.status].text}</Badge>}
                    />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </section>

        <section>
          <SectionTitle title="후원 페이지" description="시청자에게 공유할 주소입니다." />
          <Card>
            <div className="space-y-3">
              <CopyField label="크리에이터 코드" value={creator.code} hint="후원자가 코드로 채널을 찾을 수 있습니다." />
              <CopyField label="후원 페이지 URL" value={donationPageUrl} hint="방송 설명란이나 커뮤니티에 공유해 주세요." />
            </div>
          </Card>
        </section>
      </div>
    </>
  );
}
