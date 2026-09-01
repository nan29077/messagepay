import * as React from 'react';

/** 메시지 말풍선과 결제 완료 체크를 결합한 message pay 브랜드 심볼. */
export function MessagePayMark({
  size = 32,
  className,
  onDark = false,
}: {
  size?: number;
  className?: string;
  onDark?: boolean;
}) {
  const background = onDark ? '#b7f34a' : '#071426';
  const foreground = onDark ? '#071426' : '#b7f34a';

  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} aria-hidden>
      <rect x="3" y="3" width="42" height="42" rx="13" fill={background} />
      <path
        d="M13 14.5h22a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H24l-6.8 5.2c-.7.5-1.7 0-1.7-.9v-4.3H13a3 3 0 0 1-3-3v-11a3 3 0 0 1 3-3Z"
        fill={foreground}
      />
      <path d="m25.4 23 3.2 3.1 5.5-6" stroke={background} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16.2" cy="23" r="1.5" fill={background} />
      <circle cx="21" cy="23" r="1.5" fill={background} />
    </svg>
  );
}

/** 이전 화면의 import 호환을 유지하되 실제 표시는 message pay 심볼로 통일한다. */
export const MessagepayMark = MessagePayMark;

export function Logo({ compact = false, onDark = false }: { compact?: boolean; onDark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <MessagePayMark size={compact ? 30 : 34} onDark={onDark} />
      {!compact ? (
        <span aria-label="MessagePay 메시지페이" className="text-[19px] font-black leading-none tracking-[-0.045em]">
          <span className={onDark ? 'text-white' : 'text-ink-900'}>Message</span>
          <span className={onDark ? 'text-[#b7f34a]' : 'text-[#5f870b]'}>Pay</span>
        </span>
      ) : null}
    </span>
  );
}
