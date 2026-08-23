'use client';

import * as React from 'react';
import { formatNumber } from '@/lib/money';
import { EffectLayer } from '@/components/overlay/overlay-effects';

/**
 * OBS / PRISM 브라우저 소스용 오버레이 클라이언트.
 *
 * 규칙
 *  - 서버 모듈을 import 하지 않는다. 페이로드 타입만 재정의해 사용한다.
 *  - 여러 건이 동시에 도착해도 대기열에 넣고 한 건씩 순차 재생한다.
 *  - TTS 재생이 끝나기 전에는 다음 항목으로 넘어가지 않는다(표시시간과 음성 길이 중 긴 쪽 기준).
 *  - 연결 상태는 방송 화면에 표시하지 않는다. 디버그 모드에서만 배지를 노출한다.
 *  - 금액 구간(effect/banner/durationMs)이 없는 예전 이벤트도 그대로 재생돼야 한다.
 */

export interface OverlayTts {
  enabled: boolean;
  text: string;
  voice: string;
  speed: number;
  pitch?: number;
  volume: number;
}

export interface OverlayPayload {
  eventId: string;
  creatorId: string;
  donationId: string | null;
  donorName: string;
  amount: string;
  message: string;
  sticker: string;
  /** 금액 구간에서 고른 파티클 효과. 없으면 sticker 값으로 대체한다. */
  effect?: string;
  /** 배너 표시 여부. 없으면(예전 이벤트) 표시한다. */
  banner?: boolean;
  tierLabel?: string;
  tts: OverlayTts | null;
  durationMs: number;
  occurredAt: string;
  isTest: boolean;
}

const OUT_MS = 360; // globals.css 의 .animate-tornado-out 길이와 맞춘다
const MAX_BACKOFF_MS = 30000;

const positionClass: Record<string, string> = {
  TOP_LEFT: 'items-start justify-start',
  TOP_CENTER: 'items-start justify-center',
  TOP_RIGHT: 'items-start justify-end',
  MIDDLE_CENTER: 'items-center justify-center',
  CENTER: 'items-center justify-center',
  BOTTOM_LEFT: 'items-end justify-start',
  BOTTOM_CENTER: 'items-end justify-center',
  BOTTOM_RIGHT: 'items-end justify-end',
};

/** 배너를 끈 경우에도 효과 재생 시간은 유지된다. */
function effectOf(payload: OverlayPayload): string {
  return payload.effect || payload.sticker || 'DEFAULT';
}

function bannerOf(payload: OverlayPayload): boolean {
  return payload.banner !== false;
}

export function OverlayClient({
  creatorId,
  token,
  preview = false,
  position = 'BOTTOM_CENTER',
  defaultDurationMs = 7000,
  maxMessageLen = 80,
  debug = false,
}: {
  creatorId: string;
  token: string;
  /** 스튜디오 미리보기 모드. 토큰 대신 세션으로 인증한다. */
  preview?: boolean;
  position?: string;
  defaultDurationMs?: number;
  maxMessageLen?: number;
  debug?: boolean;
}) {
  const [current, setCurrent] = React.useState<OverlayPayload | null>(null);
  const [leaving, setLeaving] = React.useState(false);
  const [connected, setConnected] = React.useState(false);
  const [queueLen, setQueueLen] = React.useState(0);

  const queue = React.useRef<OverlayPayload[]>([]);
  const busy = React.useRef(false);
  const seen = React.useRef<Set<string>>(new Set());
  const playNextRef = React.useRef<() => void>(() => {});

  // 브라우저 음성 목록은 비동기로 로드되므로 미리 한 번 요청해 둔다.
  React.useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const warm = () => window.speechSynthesis.getVoices();
    warm();
    window.speechSynthesis.addEventListener?.('voiceschanged', warm);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', warm);
  }, []);

  // ------------------------------------------------------------- 재생 파이프라인
  React.useEffect(() => {
    let disposed = false;
    // 파이프라인이 재구성되면 이전 재생 상태를 초기화한다(대기열 정지 방지).
    busy.current = false;

    const speak = (tts: OverlayTts | null): Promise<void> =>
      new Promise((resolve) => {
        if (!tts || !tts.enabled || !tts.text) return resolve();
        if (typeof window === 'undefined' || !('speechSynthesis' in window)) return resolve();

        try {
          const synth = window.speechSynthesis;
          const utter = new SpeechSynthesisUtterance(tts.text);
          const voices = synth.getVoices();
          const matched =
            voices.find((v) => v.name === tts.voice) ??
            voices.find((v) => v.voiceURI === tts.voice) ??
            voices.find((v) => v.lang?.toLowerCase().startsWith('ko')) ??
            null;
          if (matched) utter.voice = matched;
          utter.lang = matched?.lang ?? 'ko-KR';
          utter.rate = Math.min(2, Math.max(0.5, Number(tts.speed) || 1));
          utter.pitch = Math.min(2, Math.max(0, Number(tts.pitch ?? 1)));
          utter.volume = Math.min(1, Math.max(0, Number(tts.volume ?? 1)));

          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(guard);
            resolve();
          };
          // onend 가 오지 않는 브라우저를 대비한 안전장치
          const guard = setTimeout(finish, 60000);
          utter.onend = finish;
          utter.onerror = finish;
          synth.speak(utter);
        } catch {
          resolve();
        }
      });

    const playNext = () => {
      if (disposed || busy.current) return;
      const next = queue.current.shift();
      if (!next) return;
      setQueueLen(queue.current.length);

      busy.current = true;
      setLeaving(false);
      setCurrent(next);

      const duration = Math.max(1500, Number(next.durationMs) || defaultDurationMs);
      const shown = new Promise<void>((r) => setTimeout(r, duration));

      // 표시 시간과 TTS 재생 시간 중 긴 쪽을 기준으로 다음 항목으로 넘어간다.
      Promise.all([shown, speak(next.tts)]).then(() => {
        if (disposed) return;
        setLeaving(true);
        setTimeout(() => {
          if (disposed) return;
          setCurrent(null);
          setLeaving(false);
          busy.current = false;
          playNext();
        }, OUT_MS);
      });
    };

    playNextRef.current = playNext;

    return () => {
      disposed = true;
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* ignore */
        }
      }
    };
  }, [defaultDurationMs]);

  // --------------------------------------------------------------- SSE 구독
  React.useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (disposed) return;
      const auth = preview ? 'preview=1' : `token=${encodeURIComponent(token)}`;
      const url = `/api/overlay/${encodeURIComponent(creatorId)}/stream?${auth}`;
      const es = new EventSource(url);
      source = es;

      es.onopen = () => {
        retry = 0;
        setConnected(true);
        console.log('[overlay] 연결됨');
      };

      es.addEventListener('ready', () => {
        retry = 0;
        setConnected(true);
        // 스튜디오 미리보기(iframe)에 구독 완료를 알린다. 구독 전에 보낸 테스트 이벤트는
        // 서버가 보관하지 않으므로, 부모 창은 이 신호를 받은 뒤에 자동 발동해야 한다.
        if (preview && typeof window !== 'undefined' && window.parent !== window) {
          try {
            window.parent.postMessage({ type: 'donaido-overlay-ready', creatorId }, window.location.origin);
          } catch {
            /* ignore */
          }
        }
      });

      es.addEventListener('donation', (ev) => {
        try {
          const payload = JSON.parse((ev as MessageEvent).data) as OverlayPayload;
          if (!payload?.eventId || seen.current.has(payload.eventId)) return;
          seen.current.add(payload.eventId);
          if (seen.current.size > 500) seen.current = new Set();
          queue.current.push(payload);
          setQueueLen(queue.current.length);
          playNextRef.current();
        } catch (e) {
          console.log('[overlay] 이벤트 파싱 실패', e);
        }
      });

      es.onerror = () => {
        setConnected(false);
        es.close();
        if (disposed) return;
        // 지수 백오프 (최대 30초). 재연결 상태는 화면에 표시하지 않는다.
        const wait = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** retry);
        retry += 1;
        console.log(`[overlay] 연결 끊김. ${Math.round(wait / 1000)}초 후 재연결`);
        timer = setTimeout(connect, wait);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      source?.close();
    };
  }, [creatorId, token, preview]);

  const align = positionClass[position] ?? positionClass.BOTTOM_CENTER;

  return (
    <div className="pointer-events-none fixed inset-0 h-screen w-screen bg-transparent">
      {/* 파티클은 배너를 끈 구간에서도 재생된다 */}
      {current && !leaving ? <EffectLayer effect={effectOf(current)} /> : null}

      <div className={`relative flex h-full w-full p-8 ${align}`}>
        {current && bannerOf(current) ? (
          <DonationCard payload={current} leaving={leaving} maxMessageLen={maxMessageLen} />
        ) : null}
      </div>

      {debug ? (
        <span className="fixed left-3 top-3 rounded-md bg-ink-900/80 px-2 py-1 text-[11px] font-semibold text-white">
          {connected ? '연결됨' : '재연결 중'} · 대기 {queueLen}
          {current?.tierLabel ? ` · ${current.tierLabel}` : ''}
        </span>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ 알림 배너

function DonationCard({
  payload,
  leaving,
  maxMessageLen,
}: {
  payload: OverlayPayload;
  leaving: boolean;
  maxMessageLen: number;
}) {
  const amountText = payload.amount ? `${formatNumber(BigInt(payload.amount))}원` : '';
  const message =
    payload.message.length > maxMessageLen ? `${payload.message.slice(0, maxMessageLen)}...` : payload.message;

  return (
    <div
      className={`relative w-[560px] max-w-full rounded-[28px] border border-white/40 bg-white/95 px-7 py-6 shadow-[0_18px_48px_rgba(19,26,58,0.28)] ${
        leaving ? 'animate-tornado-out' : 'animate-banner-in'
      }`}
    >
      {payload.isTest ? (
        <span className="absolute right-4 top-4 rounded-md bg-ink-100 px-2 py-0.5 text-[11px] font-bold text-ink-500">
          테스트
        </span>
      ) : null}

      <div className="flex items-center gap-4">
        <TornadoSwirl />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[22px] font-extrabold leading-tight tracking-tight text-ink-900">
            {payload.donorName}님이 {amountText ? `${amountText}을 ` : ''}후원했습니다
          </p>
          {message ? (
            <p className="mt-2 break-words text-[17px] leading-snug text-ink-700">{message}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <ThanksSticker variant={effectOf(payload)} />
        <span className="text-[12px] font-semibold tracking-[0.16em] text-ink-300">DONAIDO</span>
      </div>
    </div>
  );
}

/** 회오리 라인 애니메이션 */
function TornadoSwirl() {
  return (
    <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-700">
      <svg
        width={40}
        height={40}
        viewBox="0 0 32 32"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        className="animate-tornado-spin"
        aria-hidden
      >
        <path d="M5 7h22" />
        <path d="M8 12h16" />
        <path d="M11 17h10" />
        <path d="M13.5 22h5" />
        <path d="M15.5 26.5h1.5" />
        <path d="M24 12c0 6-4.5 9.5-8 14.5" opacity="0.45" />
      </svg>
    </span>
  );
}

/** 감사 스티커 (라인 배지) */
function ThanksSticker({ variant }: { variant: string }) {
  const label = variant === 'SIMPLE' ? '고맙습니다' : '감사합니다';
  return (
    <span className="animate-thanks-bounce inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-[13px] font-bold text-brand-700">
      <svg
        width={18}
        height={18}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M12 20.5 4.8 13.3a4.4 4.4 0 0 1 6.2-6.2l1 1 1-1a4.4 4.4 0 0 1 6.2 6.2Z" />
        <path d="M8.5 10.5h2" opacity="0.5" />
      </svg>
      {label}
    </span>
  );
}
