import * as React from 'react';

/**
 * 도네이도 브랜드 로고 (v3).
 *
 * 노란색 토네이도 소용돌이 + 우측 상단 하트 심볼과
 * 볼드 대문자 "DONAIDO" 워드마크로 구성한다.
 * (사용자 제공 로고 시안을 벡터로 재현 — 아이콘은 꿀색 그라데이션,
 *  워드마크는 잉크 블랙. 텍스트는 HTML 로 렌더링해 어떤 해상도에서도 선명하다.)
 */

export function TornadoMark({
  size = 28,
  className,
  /** true 면 브랜드 노랑 그라데이션, false 면 currentColor 스트로크 */
  colored = true,
}: {
  size?: number;
  className?: string;
  colored?: boolean;
}) {
  // 같은 화면에 여러 개 렌더링돼도 gradient id 가 충돌하지 않게 한다.
  const gradId = React.useId().replace(/[^a-zA-Z0-9]/g, '');
  const stroke = colored ? `url(#g${gradId})` : 'currentColor';
  const heartFill = colored ? `url(#g${gradId})` : 'currentColor';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden
    >
      {colored ? (
        <defs>
          <linearGradient id={`g${gradId}`} x1="6" y1="4" x2="42" y2="46" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#ffd93d" />
            <stop offset="0.55" stopColor="#fbb914" />
            <stop offset="1" stopColor="#eda600" />
          </linearGradient>
        </defs>
      ) : null}

      {/* 토네이도 소용돌이: 위가 넓고 아래로 갈수록 좁아지는 3단 스파이럴 + 꼬리 */}
      <g stroke={stroke} strokeWidth={4.4} strokeLinecap="round" strokeLinejoin="round">
        <path d="M7.5 12.2C13 6.6 30.6 5.4 36.8 10.2C42.6 14.7 34.6 20 23.4 19.4C13.9 18.8 10.5 15 14.9 12.3C19.6 9.4 30.5 10.5 32.4 14.6" />
        <path d="M14.6 24.6C13.4 28.4 17.7 30.8 24 30.6C29.5 30.4 33 28.3 32.6 25.5" opacity="0.95" />
        <path d="M18.3 35.2C17.9 38 20.6 39.7 24.2 39.5C27.2 39.3 29.2 38 29.2 36.2" opacity="0.9" />
        <path d="M22.3 44.2C23.2 45.2 24.6 45.6 26.2 45.4" opacity="0.85" />
      </g>

      {/* 우측 상단 하트 */}
      <path
        d="M40.9 3.2c1.5 0 2.7 1.2 2.7 2.7 0 2.3-2.5 3.9-4.3 5-1.8-1.1-4.3-2.7-4.3-5 0-1.5 1.2-2.7 2.7-2.7 0.9 0 1.5 0.5 1.6 1 0.1-0.5 0.7-1 1.6-1z"
        fill={heartFill}
      />
    </svg>
  );
}

export function Logo({
  compact = false,
  /** 어두운 배경 위에 놓일 때 true 로 지정하면 워드마크가 흰색이 된다. */
  onDark = false,
}: {
  compact?: boolean;
  onDark?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <TornadoMark size={compact ? 30 : 34} />
      {!compact ? (
        <span
          className={`text-[19px] font-black leading-none tracking-[-0.02em] ${onDark ? 'text-white' : 'text-ink-900'}`}
        >
          DONAIDO
        </span>
      ) : null}
    </span>
  );
}
