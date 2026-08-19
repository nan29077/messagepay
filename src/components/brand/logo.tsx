import * as React from 'react';

/**
 * 토네이도 심볼. 라인형 스트로크만 사용하며 문자는 HTML 로 렌더링한다.
 * (생성형 이미지 안에 글자를 넣지 않는다는 원칙과 동일한 기조)
 */
export function TornadoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <path d="M5 7h22" />
      <path d="M8 12h16" />
      <path d="M11 17h10" />
      <path d="M13.5 22h5" />
      <path d="M15.5 26.5h1.5" />
      <path d="M24 12c0 6-4.5 9.5-8 14.5" opacity="0.45" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-ink-900">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-500 text-white">
        <TornadoMark size={22} />
      </span>
      {!compact ? (
        <span className="flex flex-col leading-none">
          <span className="text-[16px] font-extrabold tracking-tight">토네이도</span>
          <span className="mt-0.5 text-[10px] font-semibold tracking-[0.18em] text-ink-400">TORNADO</span>
        </span>
      ) : null}
    </span>
  );
}
