import { ChevronDown, ExternalLink } from 'lucide-react';
import { Badge, Card, CardTitle, DataRow, Field, Input, LinkButton, Notice, SectionTitle, Textarea } from '@/components/ui';
import { PageHeader } from '@/components/layout/console-shell';
import { ActionForm } from '@/components/studio/action-form';
import { CopyField } from '@/components/studio/copy';
import { OverlayTiersEditor } from '@/components/studio/overlay-tiers-editor';
import { OverlayQuickSettings } from '@/components/studio/overlay-quick-settings';
import {
  regenerateOverlayTokenAction,
  testOverlayAction,
} from '@/app/actions/studio';
import { requireCreator } from '@/server/auth';
import { prisma } from '@/server/db';
import { env } from '@/lib/env';
import { formatKst } from '@/lib/datetime';
import { listOverlayTiers } from '@/server/services/overlay-tiers';
import { countOverlayConnections, MAX_OVERLAY_CONNECTIONS } from '@/server/services/overlay-connections';

export const dynamic = 'force-dynamic';

export default async function StudioOverlayPage() {
  const { creatorId } = await requireCreator();
  const [setting, ttsSetting, tiers] = await Promise.all([
    prisma.overlaySetting.findUnique({ where: { creatorId } }),
    prisma.ttsSetting.findUnique({ where: { creatorId } }),
    listOverlayTiers(creatorId),
  ]);

  // BigInt 는 클라이언트 컴포넌트로 넘길 수 없으므로 숫자로 바꿔 전달한다.
  const tierInputs = tiers.map((t) => ({
    minAmount: Number(t.minAmount),
    label: t.label,
    effect: t.effect,
    banner: t.banner,
    durationMs: t.durationMs,
    ttsEnabled: t.ttsEnabled,
    ttsVoice: t.ttsVoice,
    ttsSpeed: t.ttsSpeed,
    ttsPitch: t.ttsPitch,
  }));

  // OBS 브라우저 소스가 실제로 붙어 있는지 크리에이터가 확인할 수 있게 현재 연결 수를 보여 준다.
  // (이 서버 인스턴스 기준. 다중 인스턴스 배포에서는 인스턴스별 수치다)
  const liveConnections = countOverlayConnections(creatorId);

  const urlBase = `${env.baseUrl}/overlay/${creatorId}?token=`;

  return (
    <>
      <PageHeader title="방송·오버레이" description="OBS·PRISM 브라우저 소스 오버레이를 관리합니다. 결제가 완료된 후원은 유튜브 댓글 전송과 동시에 감사 애니메이션이 오버레이에 표시됩니다." />

      <div className="space-y-6">
        {/* ── 1. OBS 연결 ─────────────────────────────────────── */}
        <section>
          <SectionTitle
            title="OBS 연결"
            description="OBS 또는 PRISM 에서 [소스 추가] → [브라우저]를 선택하고 아래 URL을 붙여넣으면 끝입니다. (권장 크기 1920x1080)"
          />
          <div className="grid gap-2.5 lg:grid-cols-2">
            <Card>
              <CardTitle>브라우저 소스 URL</CardTitle>
              <div className="mt-2">
                <DataRow
                  label="발급 상태"
                  value={setting ? <Badge tone="success">발급됨</Badge> : <Badge tone="warning">미발급</Badge>}
                />
                <DataRow
                  label="토큰(마스킹)"
                  value={<span className="font-mono text-[12px]">{setting?.tokenMasked ?? '-'}</span>}
                />
                <DataRow label="마지막 변경" value={formatKst(setting?.updatedAt)} />
                <DataRow
                  label="현재 연결"
                  value={
                    liveConnections > 0 ? (
                      <Badge tone="success">{liveConnections}개 연결됨</Badge>
                    ) : (
                      <Badge tone="neutral">연결 없음</Badge>
                    )
                  }
                />
              </div>
              <div className="mt-3 space-y-3">
                <CopyField
                  label="URL 형식"
                  value={`${urlBase}<발급된 토큰>`}
                  hint="토큰은 해시로만 저장되어 원문을 다시 확인할 수 없습니다. 전체 URL은 발급 직후 한 번만 표시되니 그때 복사해 두세요."
                />
                <p className="text-[12px] leading-relaxed text-ink-400">
                  OBS · PRISM 에서 브라우저 소스를 열어 두면 위 [현재 연결] 수치가 올라갑니다. 한 페이지에
                  동시에 열 수 있는 연결은 최대 {MAX_OVERLAY_CONNECTIONS}개이며, 넘으면 가장 오래된 연결부터 자동으로
                  정리됩니다. 방송 중 연결이 끊겼다가 다시 붙으면 끊긴 사이의 후원 알림(최근 5분 이내)을
                  자동으로 다시 받아 재생합니다.
                </p>
                <LinkButton
                  href={`/overlay/${creatorId}?preview=1&debug=1`}
                  target="_blank"
                  variant="secondary"
                  size="sm"
                >
                  <ExternalLink size={15} strokeWidth={1.7} />
                  새 탭에서 미리보기
                </LinkButton>
              </div>
            </Card>

            <Card>
              <CardTitle>{setting ? 'URL 재발급' : 'URL 발급'}</CardTitle>
              <div className="mb-3 mt-2">
                {setting ? (
                  <Notice tone="danger" title="재발급하면 기존 URL이 즉시 무효화됩니다">
                    방송 프로그램에 등록된 기존 브라우저 소스는 더 이상 동작하지 않습니다. 재발급 후 표시되는 새 URL을
                    OBS·PRISM에 다시 등록해 주세요. 새 URL은 발급 직후 이 화면에서 한 번만 표시됩니다.
                  </Notice>
                ) : (
                  <Notice tone="brand" title="먼저 URL을 발급해 주세요">
                    발급 버튼을 누르면 OBS에 붙여넣을 전체 URL이 표시됩니다. 이 값은 한 번만 표시되니 바로 복사해
                    두세요.
                  </Notice>
                )}
              </div>
              <ActionForm
                action={regenerateOverlayTokenAction}
                submitLabel={setting ? 'URL 재발급' : 'URL 발급'}
                variant={setting ? 'danger' : 'primary'}
                size="md"
                confirmMessage={setting ? '새 URL을 발급하면 기존 브라우저 소스 URL이 즉시 무효화됩니다. 계속할까요?' : undefined}
              />
            </Card>
          </div>

          <details className="group mt-2.5 rounded-2xl border border-ink-100 bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 [&::-webkit-details-marker]:hidden">
              <span>
                <span className="block text-[14px] font-bold text-ink-900">자세한 등록 방법</span>
                <span className="block text-[12px] text-ink-400">OBS · PRISM 브라우저 소스 추가 순서</span>
              </span>
              <ChevronDown size={18} strokeWidth={1.7} className="text-ink-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-ink-100 px-4 py-4">
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
                  URL이 유출되면 제3자가 후원 알림 내용을 볼 수 있습니다. 방송 화면 공유·원격 지원 중에는 URL이
                  노출되지 않도록 주의하고, 노출이 의심되면 즉시 재발급해 주세요.
                </Notice>
              </div>
            </div>
          </details>
        </section>

        {/* ── 2. 알림 꾸미기 (효과 · 테마 · TTS) ───────────────── */}
        <section>
          {setting ? (
            <OverlayQuickSettings
              setting={{
                enabled: setting.enabled,
                showAmount: setting.showAmount,
                showMessage: setting.showMessage,
                anonymize: setting.anonymize,
                maxMessageLen: setting.maxMessageLen,
                durationMs: setting.durationMs,
                position: setting.position,
                theme: setting.theme,
                stickerSet: setting.stickerSet,
                soundEnabled: setting.soundEnabled,
                soundVolume: setting.soundVolume,
              }}
              tts={
                ttsSetting
                  ? {
                      enabled: ttsSetting.enabled,
                      voice: ttsSetting.voice,
                      speed: ttsSetting.speed,
                      provider: ttsSetting.provider,
                      // 인증 정보 원문은 어떤 경로로도 화면에 내려보내지 않는다.
                      naverClientIdMasked: ttsSetting.naverClientIdMasked,
                      hasNaverKey: Boolean(ttsSetting.naverClientIdEnc && ttsSetting.naverClientSecretEnc),
                    }
                  : null
              }
            />
          ) : (
            <>
              <SectionTitle title="알림 꾸미기" description="효과 · 테마 · TTS 를 설정합니다." />
              <Notice tone="warning">
                오버레이 설정이 아직 없습니다. 위에서 브라우저 소스 URL을 먼저 발급해 주세요.
              </Notice>
            </>
          )}
        </section>

        {/* ── 3. 고급 설정 (금액 구간별 효과) ─────────────────── */}
        <section>
          <details className="group rounded-2xl border border-ink-100 bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 [&::-webkit-details-marker]:hidden">
              <span>
                <span className="block text-[14px] font-bold text-ink-900">고급 설정 — 금액 구간별 효과</span>
                <span className="block text-[12px] text-ink-400">
                  금액대별로 다른 효과 · 배너 · TTS 를 적용하려면 여기서 설정하세요.
                </span>
              </span>
              <ChevronDown size={18} strokeWidth={1.7} className="text-ink-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-ink-100 px-4 py-4">
              <p className="mb-3 text-[12.5px] leading-relaxed text-ink-500">
                후원 금액에 따라 스티커 효과, 배너, TTS 를 다르게 재생합니다. 설정을 바꾼 뒤에는 [구간 저장]을 눌러야
                미리보기와 실제 방송에 반영됩니다.
              </p>
              <OverlayTiersEditor creatorId={creatorId} initialTiers={tierInputs} />
            </div>
          </details>
        </section>

        {/* ── 4. 테스트 ───────────────────────────────────────── */}
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
      </div>
    </>
  );
}
