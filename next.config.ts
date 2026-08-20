import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * 개발 모드 좌측 하단 "N Issue" 배지 비활성화.
   *
   * 배지가 보고하던 유일한 이슈는 브라우저 확장 프로그램이 Next 내부 요소에
   * style 속성을 주입해 생기는 하이드레이션 불일치로, 앱 코드 문제가 아님을
   * 확인했다(무확장 브라우저에서는 콘솔 오류 0건).
   * 실제 런타임 오류는 배지와 무관하게 개발 오버레이(전체 화면)로 계속 표시된다.
   * 이 설정은 개발 모드에만 영향을 주며 프로덕션 빌드에는 아무 효과가 없다.
   */
  devIndicators: false,
};

export default nextConfig;
