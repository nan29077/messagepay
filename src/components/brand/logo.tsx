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
      strokeWidth={2}
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <path d="M5.3 8.4C10.4 4.6 22.6 4.8 26.7 9.5C30.8 14.2 22.4 17.2 13.5 15.7C5.8 14.4 4.5 10.8 9.2 9.3C14.3 7.7 24.6 9.8 23.1 14.3" />
      <path d="M22.8 14.2C21.7 18.2 17.1 18.3 13.2 17.8C9.7 17.3 8.7 19.6 11.2 21.1C13.8 22.7 19.5 21.9 20.1 19.2" opacity="0.82" />
      <path d="M18.9 21.2C17.8 24.6 14.7 24.7 13.2 23.8C12.1 23.1 12.7 25.1 15.6 27.3" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-ink-900">
      <span className="grid h-10 w-10 place-items-center rounded-[14px] bg-[linear-gradient(145deg,#8d68ff_0%,#6535e8_62%,#4721ad_100%)] text-white shadow-[0_8px_18px_rgba(101,53,232,0.28)] ring-1 ring-white/30">
        <TornadoMark size={22} />
      </span>
      {!compact ? (
        <span className="flex flex-col leading-none">
          <span className="text-[17px] font-black tracking-[-0.045em]">토네이도</span>
          <span className="mt-1 text-[9px] font-extrabold tracking-[0.24em] text-brand-500">TORNADO</span>
        </span>
      ) : null}
    </span>
  );
}
