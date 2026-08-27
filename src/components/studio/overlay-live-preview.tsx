'use client';

import * as React from 'react';
import { ExternalLink, Monitor, MonitorPlay, PlugZap, RotateCw, Smartphone, Wifi } from 'lucide-react';
import { Badge, Button, Notice, cx } from '@/components/ui';

/**
 * 테스트 후원 실행 화면에 붙는 미리보기.
 *
 * 규칙
 *  - 이모지를 쓰지 않는다. 아이콘은 lucide-react 라인 아이콘만 사용한다.
 *  - [PC 방송] 탭: OBS·PRISM 이 여는 것과 같은 `/overlay/[creatorId]` 페이지를 16:9 프레임에
 *    그대로 띄운다. 토큰 원문은 해시로만 저장되어 다시 꺼낼 수 없으므로, 같은 경로를 세션으로
 *    인증하는 `preview=1` 로 연다. 렌더링·SSE 구독·효과·TTS 경로는 브라우저 소스와 동일하다.
 *  - [모바일] 탭: 후원자가 보는 후원 페이지(`/c/[code]`)를 세로 프레임(390px 기준)에 띄운다.
 *    오버레이와는 별개 화면이라 SSE·테스트 후원과 무관하다.
 *  - 두 iframe 은 모두 마운트해 두고 CSS 로만 감춘다. 탭을 옮길 때마다 오버레이 iframe 이
 *    다시 마운트되면 SSE 가 끊겨 [테스트 후원 보내기]가 재생되지 않는다.
 *  - 이 창이 SSE 로 붙어 있어야 [테스트 후원 보내기]가 즉시 재생된다.
 *    (오버레이 이벤트는 그 시점의 구독자에게만 전달된다)
 *  - 연결 상태는 오버레이가 postMessage 로 알려 준다(overlay-client 의 notifyParent).
 *  - 테마 · 표시 위치 · 최대 글자 수는 이벤트 페이로드에 실려 오므로, 설정을 저장한 뒤
 *    이 iframe 을 다시 불러오지 않아도 다음 테스트 후원부터 곧바로 반영된다.
 */

/** 모바일 프레임 기준 크기. 세로형 스마트폰 화면 폭이다. */
const MOBILE_WIDTH = 390;
const MOBILE_HEIGHT = 760;
/** 단말기 테두리 두께. 테두리를 포함해도 안쪽 화면이 정확히 기준 크기가 되도록 더해 준다. */
const MOBILE_BEZEL = 6;

type PreviewTab = 'pc' | 'mobile';

const TABS: { value: PreviewTab; label: string; Icon: typeof Monitor }[] = [
  { value: 'pc', label: 'PC 방송', Icon: Monitor },
  { value: 'mobile', label: '모바일', Icon: Smartphone },
];

interface LinkState {
  phase: string;
  retrySec?: number;
  recovered?: number;
}

function ConnectionBadge({ link }: { link: LinkState | null }) {
  if (!link || link.phase === 'connecting') {
    return (
      <Badge tone="neutral">
        <PlugZap size={13} strokeWidth={1.7} className="mr-1 inline-block align-[-2px]" />
        연결 중
      </Badge>
    );
  }
  if (link.phase === 'retrying') {
    return (
      <Badge tone="warning">
        <PlugZap size={13} strokeWidth={1.7} className="mr-1 inline-block align-[-2px]" />
        재연결 중{link.retrySec ? ` (${link.retrySec}초 후 재시도)` : ''}
      </Badge>
    );
  }
  return (
    <Badge tone="success">
      <Wifi size={13} strokeWidth={1.7} className="mr-1 inline-block align-[-2px]" />
      연결됨{link.recovered ? ` · 놓친 알림 ${link.recovered}건 복구` : ''}
    </Badge>
  );
}

export function OverlayLivePreview({
  creatorId,
  creatorCode,
}: {
  creatorId: string;
  /** 후원 페이지 코드. 모바일 탭에서 `/c/[code]` 를 띄우는 데 쓴다. */
  creatorCode?: string;
}) {
  const [tab, setTab] = React.useState<PreviewTab>('pc');
  const [link, setLink] = React.useState<LinkState | null>(null);
  // 값이 바뀌면 iframe 이 새로 마운트되어 SSE 를 다시 연결한다.
  const [reloadKey, setReloadKey] = React.useState(0);
  const [mobileKey, setMobileKey] = React.useState(0);
  const overlayFrame = React.useRef<HTMLIFrameElement | null>(null);

  React.useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as
        | { type?: string; creatorId?: string; phase?: string; retrySec?: number; recovered?: number }
        | null;
      if (!data || data.creatorId !== creatorId) return;
      if (data.type === 'donaido-overlay-ready') setLink((prev) => prev ?? { phase: 'connected' });
      if (data.type === 'donaido-overlay-status' && data.phase) {
        setLink({ phase: data.phase, retrySec: data.retrySec, recovered: data.recovered });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [creatorId]);

  /**
   * 첫 상태 알림을 놓쳤을 때를 대비한 재문의.
   *
   * iframe 은 이 화면이 하이드레이션되기 전에 이미 로드를 시작하므로, 오버레이가 먼저
   * 연결되면 [연결됨] 알림이 위 리스너가 붙기 전에 날아가 배지가 [연결 중]에서 멈춘다.
   * 상태를 한 번이라도 받을 때까지만 짧게 되물어 본다.
   */
  React.useEffect(() => {
    if (link) return;
    const ask = () => {
      try {
        overlayFrame.current?.contentWindow?.postMessage(
          { type: 'donaido-overlay-hello' },
          window.location.origin,
        );
      } catch {
        /* 아직 로드 전 */
      }
    };
    ask();
    const timer = window.setInterval(ask, 500);
    const stop = window.setTimeout(() => window.clearInterval(timer), 15000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [link, reloadKey]);

  const isPc = tab === 'pc';
  const donationPath = creatorCode ? `/c/${encodeURIComponent(creatorCode)}` : '';

  return (
    <div className="space-y-2.5">
      {/* ── 탭 ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="미리보기 화면 선택"
          className="inline-flex rounded-xl border border-ink-100 bg-white p-1"
        >
          {TABS.map((t) => {
            const active = tab === t.value;
            return (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.value)}
                className={cx(
                  'inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-bold transition-colors',
                  active ? 'bg-brand-50 text-brand-700' : 'text-ink-400 hover:bg-ink-50 hover:text-ink-700',
                )}
              >
                <t.Icon size={16} strokeWidth={1.7} />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isPc ? (
            <>
              <ConnectionBadge link={link} />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setLink(null);
                  setReloadKey((k) => k + 1);
                }}
              >
                <RotateCw size={14} strokeWidth={1.7} />
                다시 연결
              </Button>
            </>
          ) : (
            <>
              {donationPath ? (
                <a
                  href={donationPath}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-semibold text-ink-500 hover:bg-ink-50 hover:text-ink-900"
                >
                  <ExternalLink size={14} strokeWidth={1.7} />
                  새 탭에서 열기
                </a>
              ) : null}
              <Button type="button" variant="ghost" size="sm" onClick={() => setMobileKey((k) => k + 1)}>
                <RotateCw size={14} strokeWidth={1.7} />
                다시 불러오기
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── PC 방송 (오버레이) ─────────────────────────────── */}
      {/* 감출 때도 마운트를 유지한다. 다시 마운트되면 SSE 가 끊긴다. */}
      <div role="tabpanel" hidden={!isPc} className={cx('space-y-2.5', !isPc && 'hidden')}>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-bold text-ink-900">
            <MonitorPlay size={16} strokeWidth={1.7} className="shrink-0 text-brand-700" />
            실제 방송 오버레이 미리보기 (OBS/PRISM에 적용되는 화면과 동일)
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-400">
            OBS/PRISM 브라우저 소스 기준 · 아래 [테스트 후원 보내기]를 누르면 이 화면에서 바로 재생됩니다.
          </p>
        </div>

        {/* 투명 배경임을 보여주기 위해 체커보드 위에 올린다 */}
        <div
          className="relative w-full overflow-hidden rounded-xl border border-ink-200"
          style={{
            aspectRatio: '16 / 9',
            backgroundColor: '#2b2b31',
            backgroundImage:
              'linear-gradient(45deg, rgba(255,255,255,0.06) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.06) 75%), linear-gradient(45deg, rgba(255,255,255,0.06) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.06) 75%)',
            backgroundSize: '32px 32px',
            backgroundPosition: '0 0, 16px 16px',
          }}
        >
          <iframe
            key={reloadKey}
            ref={overlayFrame}
            title="실제 방송 오버레이 미리보기"
            src={`/overlay/${encodeURIComponent(creatorId)}?preview=1`}
            className="absolute inset-0 h-full w-full border-0"
            style={{ background: 'transparent' }}
          />
        </div>

        <p className="text-[12px] leading-relaxed text-ink-400">
          체커보드 무늬는 투명 배경을 보여 주기 위한 것으로, OBS·PRISM 에서는 방송 화면이 그대로 비칩니다. 이 미리보기
          연결은 방송용 브라우저 소스 연결과 따로 관리되므로 방송 중에 열어 두어도 OBS 연결이 끊기지 않습니다. 브라우저
          자동재생 정책에 따라 이 창에서는 음성이 나오지 않을 수 있습니다.
        </p>
      </div>

      {/* ── 모바일 (후원 페이지) ───────────────────────────── */}
      <div role="tabpanel" hidden={isPc} className={cx('space-y-2.5', isPc && 'hidden')}>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-bold text-ink-900">
            <Smartphone size={16} strokeWidth={1.7} className="shrink-0 text-brand-700" />
            모바일 후원 페이지 미리보기 (후원자가 보는 화면)
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-400">
            모바일 후원 페이지 기준 · 가로 {MOBILE_WIDTH}px 세로형 화면으로 표시합니다.
          </p>
        </div>

        {donationPath ? (
          <div className="flex justify-center rounded-xl border border-ink-100 bg-ink-50 px-3 py-4">
            <div
              className="overflow-hidden rounded-[28px] border-ink-800 bg-white shadow-[0_14px_36px_rgba(19,26,58,0.18)]"
              style={{
                borderWidth: MOBILE_BEZEL,
                width: MOBILE_WIDTH + MOBILE_BEZEL * 2,
                maxWidth: '100%',
                height: MOBILE_HEIGHT + MOBILE_BEZEL * 2,
              }}
            >
              <iframe
                key={mobileKey}
                title="모바일 후원 페이지 미리보기"
                src={donationPath}
                className="h-full w-full border-0 bg-white"
              />
            </div>
          </div>
        ) : (
          <Notice tone="warning" title="후원 페이지 주소를 찾지 못했습니다">
            크리에이터 코드가 아직 발급되지 않았습니다. [프로필 설정]에서 코드를 확인한 뒤 다시 시도해 주세요.
          </Notice>
        )}

        <p className="text-[12px] leading-relaxed text-ink-400">
          후원자가 문자나 QR 로 들어오는 실제 후원 페이지입니다. 오버레이와는 별개 화면이라 [테스트 후원 보내기]로는
          바뀌지 않습니다. 프로필 · 후원 설정을 저장한 뒤 [다시 불러오기]를 누르면 반영됩니다.
        </p>
      </div>
    </div>
  );
}
