import { Card, Checkbox, Field, Input, Notice, SectionTitle, Select } from '@/components/ui';
import { PageHeader } from '@/components/layout/console-shell';
import { ActionForm } from '@/components/studio/action-form';
import { updateTtsSettingAction } from '@/app/actions/studio';
import { requireCreator } from '@/server/auth';
import { prisma } from '@/server/db';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

const VOICES = [
  { value: 'ko-KR-Standard-A', label: 'ko-KR-Standard-A (여성)' },
  { value: 'ko-KR-Standard-B', label: 'ko-KR-Standard-B (여성)' },
  { value: 'ko-KR-Standard-C', label: 'ko-KR-Standard-C (남성)' },
  { value: 'ko-KR-Standard-D', label: 'ko-KR-Standard-D (남성)' },
];

export default async function StudioTtsPage() {
  const { creatorId } = await requireCreator();
  const setting = await prisma.ttsSetting.findUnique({ where: { creatorId } });

  const enabled = setting?.enabled ?? true;
  const readAmount = setting?.readAmount ?? true;
  const readName = setting?.readName ?? true;

  return (
    <>
      <PageHeader title="TTS 설정" description="후원 메시지를 음성으로 읽어 줍니다. 오버레이 브라우저 소스에서 재생됩니다." />

      <div className="space-y-5">
        <Notice tone="warning" title={`현재 TTS provider 는 ${env.tts.provider} 입니다`}>
          지금은 별도 음성 합성 서비스와 계약되어 있지 않아, 오버레이 브라우저 소스가 브라우저 내장 음성 합성(Web Speech
          API)으로 대신 읽습니다. 음성 이름과 속도·볼륨은 브라우저와 운영체제에 따라 실제 결과가 달라질 수 있습니다.
          상용 TTS 연동 후에는 아래 설정이 그대로 적용됩니다.
        </Notice>

        <section>
          <SectionTitle title="음성 설정" />
          <Card>
            <ActionForm action={updateTtsSettingAction} submitLabel="TTS 설정 저장">
              <div className="rounded-xl border border-ink-100 px-3 py-1">
                <Checkbox name="enabled" defaultChecked={enabled} label="TTS 사용" description="끄면 후원 메시지를 음성으로 읽지 않습니다." />
                <Checkbox name="readAmount" defaultChecked={readAmount} label="후원금 읽기" />
                <Checkbox name="readName" defaultChecked={readName} label="이름 읽기" />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Field label="음성">
                  <Select name="voice" defaultValue={setting?.voice ?? 'ko-KR-Standard-A'}>
                    {VOICES.map((v) => (
                      <option key={v.value} value={v.value}>
                        {v.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="속도" hint="0.5 ~ 2.0 (1.0 이 기본 속도)">
                  <Input
                    name="speed"
                    type="number"
                    min={0.5}
                    max={2}
                    step={0.1}
                    defaultValue={setting?.speed ?? 1}
                    className="tabular-nums"
                  />
                </Field>
                <Field label="볼륨" hint="0 ~ 1 (1 이 최대)">
                  <Input
                    name="volume"
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    defaultValue={setting?.volume ?? 1}
                    className="tabular-nums"
                  />
                </Field>
                <Field label="최소 후원금 (원)" hint="이 금액 이상일 때만 음성으로 읽습니다.">
                  <Input
                    name="minAmount"
                    inputMode="numeric"
                    defaultValue={(setting?.minAmount ?? 3000n).toString()}
                    className="tabular-nums"
                  />
                </Field>
                <Field label="최대 글자 수" hint="10 ~ 200자. 초과분은 읽지 않습니다.">
                  <Input name="maxChars" type="number" min={10} max={200} defaultValue={setting?.maxChars ?? 80} />
                </Field>
              </div>
            </ActionForm>
          </Card>
        </section>

        <Notice tone="neutral">
          TTS는 오버레이에 표시되는 필터링된 메시지만 읽습니다. 금칙어 처리와 개인정보 마스킹이 적용된 뒤의 문장이
          사용되므로, 원문이 그대로 읽히지 않습니다.
        </Notice>
      </div>
    </>
  );
}
