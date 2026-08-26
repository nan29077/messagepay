'use client';

/**
 * 오버레이 세그먼트 에러 경계.
 *
 * 루트 error.tsx 는 불투명 흰 배경을 쓰므로 OBS 브라우저 소스에서 배경이 막혀 버린다.
 * 오버레이 전용 error.tsx 를 두어 투명 배경 위에 어두운 에러 알림이 뜨도록 한다.
 */
export default function OverlayError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="grid h-screen w-screen place-items-center bg-transparent">
      <div className="rounded-2xl bg-ink-900/90 px-6 py-5 text-center shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
        <p className="text-[15px] font-bold text-white">오버레이를 불러오지 못했습니다</p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/70">
          {process.env.NODE_ENV !== 'production' && error?.message
            ? error.message
            : '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'}
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 h-9 rounded-xl bg-white/15 px-4 text-[13px] font-semibold text-white hover:bg-white/25"
        >
          다시 시도
        </button>
      </div>
    </div>
  );
}
