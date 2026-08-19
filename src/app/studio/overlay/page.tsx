import { Badge, Card, CardTitle, Checkbox, DataRow, Field, Input, Notice, SectionTitle, Select, Textarea } from '@/components/ui';
import { PageHeader } from '@/components/layout/console-shell';
import { ActionForm } from '@/components/studio/action-form';
import { CopyField } from '@/components/studio/copy';
import {
  regenerateOverlayTokenAction,
  testOverlayAction,
  updateOverlaySettingAction,
} from '@/app/actions/studio';
import { requireCreator } from '@/server/auth';
import { prisma } from '@/server/db';
import { env } from '@/lib/env';
import { formatKst } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

const POSITIONS = [
  { value: 'TOP_LEFT', label: '좌측 상단' },
  { value: 'TOP_CENTER', label: '중앙 상단' },
  { value: 'TOP_RIGHT', label: '우측 상단' },
  { value: 'BOTTOM_LEFT', label: '좌측 하단' },
  { value: 'BOTTOM_CENTER', label: '중앙 하단' },
  { value: 'BOTTOM_RIGHT', label: '우측 하단' },
];

const THEMES = [
  { value: 'TORNADO', label: '토네이도 기본' },
  { value: 'MINIMAL', label: '미니멀' },
  { value: 'NEON', label: '네온' },
];

const STICKERS = [
  { value: 'DEFAULT', label: '기본 감사 스티커' },
  { value: 'HEART', label: '하트' },
  { value: 'STAR', label: '별' },
  { value: 'NONE', label: '사용 안 함' },
];

export default async function StudioOverlayPage() {
  const { creatorId } = await requireCreator();
  const setting = await prisma.overlaySetting.findUnique({ where: { creatorId } });

  const urlBase = `${env.baseUrl}/overlay/${creatorId}?token=`;

  return (
    <>
      <PageHeader title="오버레이 설정" description="OBS·PRISM 브라우저 소스로 후원 알림을 방송에 표시합니다." />

      <div className="space-y-5">
        <section>
          <SectionTitle title="브라우저 소스 URL" description="이 URL을 아는 사람은 후원 알림을 볼 수 있으므로 공유하지 마세요." />
          <div className="grid gap-2.5 lg:grid-cols-2">
            <Card>
              <CardTitle>현재 발급 상태</CardTitle>
              <div className="mt-2">
                <DataRow
                  label="발급 여부"
                  value={setting ? <Badge tone="success">발급됨</Badge> : <Badge tone="warning">미발급</Badge>}
                />
                <DataRow
                  label="토큰(마스킹)"
                  value={<span className="font-mono text-[12px]">{setting?.tokenMasked ?? '-'}</span>}
                />
                <DataRow label="마지막 변경" value={formatKst(setting?.updatedAt)} />
              </div>
              <div className="mt-3">
                <CopyField
                  label="URL 형식"
                  value={`${urlBase}<발급된 토큰>`}
                  hint="토큰은 해시로만 저장되어 원문을 다시 확인할 수 없습니다. 분실했다면 오른쪽에서 재발급해 주세요."
                />
              </div>
            </Card>

            <Card>
              <CardTitle>URL 재발급</CardTitle>
              <div className="mb-3 mt-2">
                <Notice tone="danger" title="재발급하면 기존 URL이 즉시 무효화됩니다">
                  방송 프로그램에 등록된 기존 브라우저 소스는 더 이상 동작하지 않습니다. 재발급 후 표시되는 새 URL을
                  OBS·PRISM에 다시 등록해 주세요. 새 URL은 발급 직후 이 화면에서 한 번만 표시됩니다.
                </Notice>
              </div>
              <ActionForm
                action={regenerateOverlayTokenAction}
                submitLabel={setting ? 'URL 재발급' : 'URL 발급'}
                variant={setting ? 'danger' : 'primary'}
                size="md"
                confirmMessage="새 URL을 발급하면 기존 브라우저 소스 URL이 즉시 무효화됩니다. 계속할까요?"
              />
            </Card>
          </div>
        </section>

        <section>
          <SectionTitle title="표시 설정" />
          <Card>
            {setting ? (
              <ActionForm action={updateOverlaySettingAction} submitLabel="설정 저장">
                <div className="rounded-xl border border-ink-100 px-3 py-1">
                  <Checkbox name="enabled" defaultChecked={setting.enabled} label="오버레이 표시" description="끄면 후원 알림이 방송 화면에 표시되지 않습니다." />
                  <Checkbox name="showAmount" defaultChecked={setting.showAmount} label="후원금 표시" />
                  <Checkbox name="showMessage" defaultChecked={setting.showMessage} label="메시지 표시" />
                  <Checkbox name="anonymize" defaultChecked={setting.anonymize} label="익명 처리" description="모든 후원자를 '익명의 후원자'로 표시합니다." />
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="최대 글자 수" hint="10~200자">
                    <Input name="maxMessageLen" type="number" min={10} max={200} defaultValue={setting.maxMessageLen} />
                  </Field>
                  <Field label="표시 시간 (ms)" hint="2000~30000ms">
                    <Input name="durationMs" type="number" min={2000} max={30000} step={500} defaultValue={setting.durationMs} />
                  </Field>
                  <Field label="화면 위치">
                    <Select name="position" defaultValue={setting.position}>
                      {POSITIONS.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="테마">
                    <Select name="theme" defaultValue={setting.theme}>
                      {THEMES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="감사 스티커 세트">
                    <Select name="stickerSet" defaultValue={setting.stickerSet}>
                      {STICKERS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              </ActionForm>
            ) : (
              <Notice tone="warning">
                오버레이 설정이 아직 없습니다. 위에서 브라우저 소스 URL을 먼저 발급해 주세요.
              </Notice>
            )}
          </Card>
        </section>

        <section>
          <SectionTitle title="테스트 후원 실행" description="설정한 화면을 실제 방송 전에 확인해 보세요." />
          <Card>
            <div className="mb-3">
              <Notice tone="brand">테스트 후원은 실제 결제와 정산에 반영되지 않습니다.</Notice>
            </div>
            <ActionForm action={testOverlayAction} submitLabel="테스트 후원 보내기" variant="secondary">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="표시명" hint="20자 이내">
                  <Input name="donorName" defaultValue="테스트 후원자" maxLength={20} />
                </Field>
                <Field label="금액 (원)" hint="100원 ~ 1,000,000원">
                  <Input name="amount" inputMode="numeric" defaultValue="3000" className="tabular-nums" />
                </Field>
              </div>
              <Field label="메시지">
                <Textarea name="message" rows={2} maxLength={200} defaultValue="오늘 방송 재미있어요" />
              </Field>
            </ActionForm>
          </Card>
        </section>

        <section>
          <SectionTitle title="OBS · PRISM 브라우저 소스 추가 방법" />
          <Card>
            <ol className="space-y-2 text-[13px] leading-relaxed text-ink-700">
              <li>1. 방송 프로그램의 소스 목록에서 [+] 를 눌러 브라우저(Browser) 소스를 추가합니다.</li>
              <li>2. URL 칸에 위에서 발급한 브라우저 소스 URL을 그대로 붙여넣습니다.</li>
              <li>3. 너비 1920, 높이 1080 으로 설정합니다. (권장 해상도 1920x1080)</li>
              <li>4. 사용자 정의 CSS는 비워 두세요. 오버레이가 자체적으로 투명 배경을 사용합니다.</li>
              <li>5. &quot;장면이 활성화될 때 브라우저 새로 고침&quot; 옵션을 켜면 방송 시작 시 연결이 안정적입니다.</li>
              <li>6. 소스를 화면 맨 위 레이어로 올려 다른 소스에 가려지지 않게 배치합니다.</li>
            </ol>
            <div className="mt-3">
              <Notice tone="neutral">
                URL이 유출되면 제3자가 후원 알림 내용을 볼 수 있습니다. 방송 화면 공유·원격 지원 중에는 URL이 노출되지
                않도록 주의하고, 노출이 의심되면 즉시 재발급해 주세요.
              </Notice>
            </div>
          </Card>
        </section>
      </div>
    </>
  );
}
