import type { Metadata } from 'next';

/**
 * 오버레이 전용 레이아웃.
 * OBS / PRISM 브라우저 소스는 투명 배경이 필수이므로 여백과 배경을 모두 제거한다.
 */

export const metadata: Metadata = {
  title: '토네이도 오버레이',
  robots: { index: false, follow: false },
};

export default function OverlayLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="overlay-root m-0 h-screen w-screen overflow-hidden bg-transparent p-0">
      <style>{'html,body{background:transparent !important;margin:0;padding:0;overflow:hidden;}'}</style>
      {children}
    </div>
  );
}
