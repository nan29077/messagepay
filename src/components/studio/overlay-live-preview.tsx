'use client';

import * as React from 'react';
import { MonitorPlay, PlugZap, RotateCw, Wifi } from 'lucide-react';
import { Badge, Button } from '@/components/ui';

/**
 * 테스트 후원 실행 화면에 붙는 실제 오버레이 미리보기.
 *
 * 규칙
 *  - 이모지를 쓰지 않는다. 아이콘은 lucide-react 라인 아이콘만 사용한다.
 *  - OBS·PRISM 이 여는 것과 같은 `/overlay/[creatorId]` 페이지를 iframe 으로 그대로 띄운다.
 *    토큰 원문은 해시로만 저장되어 다시 꺼낼 수 없으므로, 같은 경로를 세션으로 인증하는
 *    `preview=1` 로 연다. 렌더링·SSE 구독·효과·TTS 경로는 브라우저 소스와 동일하다.
 *  - 이 창이 SSE 로 붙어 있어야 [테스트 후원 보내기]가 즉시 재생된다.
 *    (오버레이 이벤트는 그 시점의 구독자에게만 전달된다)
 *  - 연결 상태는 오버레이가 postMessage 로 알려 준다(overlay-client 의 notifyParent).
 *  - 테마 · 표시 위치 · 최대 글자 수는 이벤트 페이로드에 실려 오므로, 설정을 저장한 뒤
 *    이 iframe 을 다시 불러오지 않아도 다음 테스트 후원부터 곧바로 반영된다.
 */

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

export function OverlayLivePreview({ creatorId }: { creatorId: string }) {
  const [link, setLink] = React.useState<LinkState | null>(null);
  // 값이 바뀌면 iframe 이 새로 마운트되어 SSE 를 다시 연결한다.
  const [reloadKey, setReloadKey] = React.useState(0);

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

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-bold text-ink-900">
            <MonitorPlay size={16} strokeWidth={1.7} className="shrink-0 text-brand-700" />
            실제 방송 오버레이 미리보기 (OBS/PRISM에 적용되는 화면과 동일)
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-400">
            아래 [테스트 후원 보내기]를 누르면 이 화면에서 바로 재생됩니다.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
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
        </div>
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
  );
}
