'use client';

import * as React from 'react';
import { Maximize2, Monitor, MonitorPlay, PlugZap, RotateCcw, RotateCw, Smartphone, Wifi, X } from 'lucide-react';
import { Badge, Button, cx } from '@/components/ui';
import { Portal } from '@/components/ui/portal';

/**
 * 테스트 후원 실행 화면에 붙는 미리보기.
 *
 * 규칙
 *  - 이모지를 쓰지 않는다. 아이콘은 lucide-react 라인 아이콘만 사용한다.
 *  - [PC 방송] 탭: OBS·PRISM 이 여는 것과 같은 `/overlay/[creatorId]` 페이지를 16:9 프레임에
 *    그대로 띄운다. 토큰 원문은 해시로만 저장되어 다시 꺼낼 수 없으므로, 같은 경로를 세션으로
 *    인증하는 `preview=1` 로 연다. 렌더링·SSE 구독·효과·TTS 경로는 브라우저 소스와 동일하다.
 *  - [모바일] 탭: 동일한 오버레이 페이지(`/overlay/[creatorId]?preview=1`)를 세로형(390x760)
 *    스마트폰 프레임에 띄운다. 테스트 후원이 세로 화면에서 어떻게 보이는지 확인하는 용도다.
 *    SSE 는 PC 탭과 독립적으로 연결되어, 테스트 후원 시 두 탭 모두에서 효과가 재생된다.
 *  - 두 iframe 은 모두 마운트해 두고 CSS 로만 감춘다. 탭을 옮길 때마다 오버레이 iframe 이
 *    다시 마운트되면 SSE 가 끊겨 [테스트 후원 보내기]가 재생되지 않는다.
 *  - 이 창이 SSE 로 붙어 있어야 [테스트 후원 보내기]가 즉시 재생된다.
 *    (오버레이 이벤트는 그 시점의 구독자에게만 전달된다)
 *  - 연결 상태는 오버레이가 postMessage 로 알려 준다(overlay-client 의 notifyParent).
 *  - 테마 · 표시 위치 · 최대 글자 수는 이벤트 페이로드에 실려 오므로, 설정을 저장한 뒤
 *    이 iframe 을 다시 불러오지 않아도 다음 테스트 후원부터 곧바로 반영된다.
 *  - debug=1 쿼리를 붙여 두면 iframe 내부에 연결 상태·대기 수를 보여 주는 배지가 뜬다.
 *    [테스트 후원 보내기] 클릭 후 대기 수가 올라가면 이벤트는 수신됨(재생 파이프라인 문제),
 *    0 그대로면 SSE 가 이벤트를 받지 못한 것이다.
 */

/** 모바일 프레임 기준 크기 (단위: px). */
const MOBILE_WIDTH = 390;
const MOBILE_HEIGHT = 760;
/** 단말기 테두리 두께. 테두리를 포함해도 안쪽 화면이 정확히 기준 크기가 되도록 더해 준다. */
const MOBILE_BEZEL = 6;

/** 체커보드 배경 (투명 오버레이임을 시각적으로 표시). PC/모바일 탭 공용. */
const CHECKERBOARD_STYLE: React.CSSProperties = {
  backgroundColor: '#2b2b31',
  backgroundImage:
    'linear-gradient(45deg, rgba(255,255,255,0.06) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.06) 75%), linear-gradient(45deg, rgba(255,255,255,0.06) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.06) 75%)',
  backgroundSize: '32px 32px',
  backgroundPosition: '0 0, 16px 16px',
};

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

/**
 * 연결 상태 배지.
 *
 * 문구 길이를 고정폭 칸 안에 가둔다.
 * 예전에는 `재연결 중 (12초 후 재시도)` 처럼 1초마다 글자 수가 달라졌고, 이 배지가
 * 탭·버튼과 같은 줄에서 자리를 다투다 보니 줄바꿈이 켜졌다 꺼졌다 하면서
 * 아래 내용 전체가 위아래로 흔들렸다. 남은 초는 크리에이터에게 의미가 없어 없앤다.
 */
function ConnectionBadge({ link }: { link: LinkState | null }) {
  const phase = !link ? 'connecting' : link.phase;
  const tone = phase === 'connected' ? 'success' : phase === 'retrying' ? 'warning' : 'neutral';
  const label = phase === 'connected' ? '연결됨' : phase === 'retrying' ? '재연결 중' : '연결 중';
  const Icon = phase === 'connected' ? Wifi : PlugZap;

  return (
    <span className="inline-flex h-7 w-[86px] shrink-0 items-center justify-center">
      <Badge tone={tone}>
        <Icon size={13} strokeWidth={1.7} className="mr-1 inline-block align-[-2px]" />
        {label}
      </Badge>
    </span>
  );
}

export function OverlayLivePreview({ creatorId }: { creatorId: string }) {
  const [tab, setTab] = React.useState<PreviewTab>('pc');
  const [link, setLink] = React.useState<LinkState | null>(null);
  /** 값이 바뀌면 PC iframe 이 새로 마운트되어 SSE 를 다시 연결한다. */
  const [reloadKey, setReloadKey] = React.useState(0);
  /** 값이 바뀌면 모바일 iframe 이 새로 마운트되어 SSE 를 다시 연결한다. */
  const [mobileKey, setMobileKey] = React.useState(0);
  const overlayFrame = React.useRef<HTMLIFrameElement | null>(null);
  const mobileFrame = React.useRef<HTMLIFrameElement | null>(null);

  /** 확대 보기(전체화면) 상태. 세로 화면에서는 가로로 눕혀 더 크게 보여 준다. */
  const [zoomOpen, setZoomOpen] = React.useState(false);
  const [zoomRotated, setZoomRotated] = React.useState(false);

  const openZoom = React.useCallback(() => {
    // 세로가 더 긴 화면(휴대폰)에서는 눕혀야 2배 이상 커진다.
    setZoomRotated(typeof window !== 'undefined' && window.innerHeight > window.innerWidth);
    setZoomOpen(true);
  }, []);

  // 확대 보기가 열려 있는 동안 배경 스크롤을 막고 ESC 로 닫는다.
  React.useEffect(() => {
    if (!zoomOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [zoomOpen]);

  /** iframe 에서 보내는 postMessage 를 수신해 연결 배지를 업데이트한다. */
  React.useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as
        | { type?: string; creatorId?: string; phase?: string; retrySec?: number; recovered?: number }
        | null;
      if (!data || data.creatorId !== creatorId) return;
      if (data.type === 'munjapay-overlay-ready') setLink((prev) => prev ?? { phase: 'connected' });
      if (data.type === 'munjapay-overlay-status' && data.phase) {
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
   * 상태를 한 번이라도 받을 때까지만 짧게 되물어 본다. PC·모바일 iframe 모두에 보낸다.
   */
  React.useEffect(() => {
    if (link) return;
    const ask = () => {
      const msg = { type: 'munjapay-overlay-hello' };
      try { overlayFrame.current?.contentWindow?.postMessage(msg, window.location.origin); } catch { /* 아직 로드 전 */ }
      try { mobileFrame.current?.contentWindow?.postMessage(msg, window.location.origin); } catch { /* 아직 로드 전 */ }
    };
    ask();
    const timer = window.setInterval(ask, 500);
    const stop = window.setTimeout(() => window.clearInterval(timer), 15000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [link, reloadKey, mobileKey]);

  const isPc = tab === 'pc';
  const overlayUrl = `/overlay/${encodeURIComponent(creatorId)}?preview=1&debug=1`;

  return (
    <div className="space-y-2.5">
      {/* ── 탭 · 상태 ───────────────────────────────────────
          좁은 화면에서는 탭과 상태 줄을 처음부터 세로로 나눈다.
          한 줄에 억지로 넣고 넘칠 때만 줄바꿈하게 두면, 상태 문구가 바뀔 때마다
          줄 수가 1↔2 로 오가면서 아래 내용이 위아래로 흔들린다. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label="미리보기 화면 선택"
          className="inline-flex self-start rounded-xl border border-ink-100 bg-white p-1"
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

        {/* 탭별 툴바. 높이를 고정해 상태가 바뀌어도 아래가 밀리지 않는다. */}
        <div className="flex h-9 shrink-0 items-center gap-1.5">
          <ConnectionBadge link={link} />
          <Button type="button" variant="ghost" size="sm" onClick={openZoom}>
            <Maximize2 size={14} strokeWidth={1.7} />
            확대
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setLink(null);
              if (isPc) setReloadKey((k) => k + 1);
              else setMobileKey((k) => k + 1);
            }}
          >
            <RotateCw size={14} strokeWidth={1.7} />
            다시 연결
          </Button>
        </div>
      </div>

      {/* ── PC 방송 (오버레이 16:9) ────────────────────────── */}
      {/* 감출 때도 마운트를 유지한다. 다시 마운트되면 SSE 가 끊긴다. */}
      <div role="tabpanel" hidden={!isPc} className={cx('space-y-2.5', !isPc && 'hidden')}>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-bold text-ink-900">
            <MonitorPlay size={16} strokeWidth={1.7} className="shrink-0 text-brand-700" />
            실제 방송 오버레이 미리보기 (OBS/PRISM에 적용되는 화면과 동일)
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-400">
            OBS/PRISM 브라우저 소스(1920x1080)를 그대로 그린 뒤 이 틀에 맞춰 축소한 화면입니다. 크기 비율이 실제
            방송과 같습니다. 아래 [테스트 후원 보내기]를 누르면 이 화면에서 바로 재생됩니다.
          </p>
        </div>

        {/* 투명 배경임을 보여주기 위해 체커보드 위에 올린다 */}
        <div
          className="relative w-full overflow-hidden rounded-xl border border-ink-200"
          style={{ aspectRatio: '16 / 9', ...CHECKERBOARD_STYLE }}
        >
          <iframe
            key={reloadKey}
            ref={overlayFrame}
            title="실제 방송 오버레이 미리보기"
            src={overlayUrl}
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

      {/* ── 모바일 (오버레이 세로형) ───────────────────────── */}
      {/* 감출 때도 마운트를 유지한다. 다시 마운트되면 SSE 가 끊긴다. */}
      <div role="tabpanel" hidden={isPc} className={cx('space-y-2.5', isPc && 'hidden')}>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-bold text-ink-900">
            <Smartphone size={16} strokeWidth={1.7} className="shrink-0 text-brand-700" />
            모바일 뷰 오버레이 미리보기 (세로형 {MOBILE_WIDTH}px 기준)
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-400">
            아래 [테스트 후원 보내기]를 누르면 세로형 프레임에서도 바로 재생됩니다.
          </p>
        </div>

        {/* 스마트폰 프레임 + 체커보드 배경 */}
        <div className="flex justify-center rounded-xl border border-ink-100 bg-[#1c1c1e] px-3 py-4">
          <div
            className="relative overflow-hidden rounded-[28px] shadow-[0_14px_36px_rgba(0,0,0,0.5)]"
            style={{
              borderWidth: MOBILE_BEZEL,
              borderStyle: 'solid',
              borderColor: '#3a3a3c',
              borderRadius: 34,
              width: MOBILE_WIDTH + MOBILE_BEZEL * 2,
              maxWidth: '100%',
              height: MOBILE_HEIGHT + MOBILE_BEZEL * 2,
              ...CHECKERBOARD_STYLE,
            }}
          >
            <iframe
              key={mobileKey}
              ref={mobileFrame}
              title="모바일 오버레이 미리보기"
              src={overlayUrl}
              className="absolute inset-0 h-full w-full border-0"
              style={{ background: 'transparent' }}
            />
          </div>
        </div>

        <p className="text-[12px] leading-relaxed text-ink-400">
          시청자가 휴대폰 세로 화면으로 방송을 볼 때 오버레이가 어떻게 보이는지 확인합니다. 방송은 가로(16:9)이므로
          화면 가운데에 표시되고 위아래는 비어 있습니다. 투명 배경이라 OBS·PRISM 에서는 방송 화면이 그대로 비칩니다.
          PC 탭과 SSE 가 각각 연결되어 두 탭 모두 테스트 후원을 받아 재생합니다.
        </p>
      </div>

      {/* ── 확대 보기 ──────────────────────────────────────
          휴대폰에서는 미리보기 틀이 320px 남짓이라 글자가 작다.
          전체화면으로 띄우고, 세로 화면이면 눕혀서 두 배 이상 크게 보여 준다. */}
      {zoomOpen ? (
        <Portal>
        <div className="fixed inset-0 z-[95] bg-black">
          <div
            className="absolute overflow-hidden"
            style={
              zoomRotated
                ? {
                    left: '50%',
                    top: '50%',
                    width: '100dvh',
                    height: '100dvw',
                    transform: 'translate(-50%, -50%) rotate(90deg)',
                    ...CHECKERBOARD_STYLE,
                  }
                : { inset: 0, ...CHECKERBOARD_STYLE }
            }
          >
            <iframe
              title="오버레이 확대 보기"
              src={overlayUrl}
              className="absolute inset-0 h-full w-full border-0"
              style={{ background: 'transparent' }}
            />
          </div>

          <div className="absolute right-3 top-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setZoomRotated((v) => !v)}
              aria-label={zoomRotated ? '세로로 보기' : '가로로 보기'}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-white/90 px-3.5 text-[13px] font-bold text-ink-900 shadow-lg"
            >
              <RotateCcw size={16} strokeWidth={1.8} />
              {zoomRotated ? '세로로' : '가로로'}
            </button>
            <button
              type="button"
              onClick={() => setZoomOpen(false)}
              aria-label="확대 보기 닫기"
              className="grid h-10 w-10 place-items-center rounded-full bg-white/90 text-ink-900 shadow-lg"
            >
              <X size={18} strokeWidth={1.9} />
            </button>
          </div>
        </div>
        </Portal>
      ) : null}
    </div>
  );
}
