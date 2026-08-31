import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './globals.css';

const shareTitle = '문자페이 | 문자 한 통으로, 결제와 충전이 끝납니다';
const shareDescription = '앱 설치 없이 문자로 간편하게 결제하고 포인트를 충전하는 쉽고 빠른 문자결제 서비스입니다.';

function isLocalUrl(value: string | undefined) {
  if (!value) return true;
  try {
    const host = new URL(value).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
  } catch {
    return true;
  }
}

/**
 * Cloudflare 임시 터널처럼 요청마다 공개 호스트가 달라지는 미리보기에서는
 * 전달된 호스트로 절대 OG 주소를 만든다. 실제 운영에서는 NEXT_PUBLIC_SITE_URL을
 * 우선하여 임의 Host 헤더가 공유 주소에 반영되지 않도록 한다.
 */
export async function generateMetadata(): Promise<Metadata> {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_BASE_URL;
  let siteUrl = configuredUrl || 'http://localhost:3030';

  if (isLocalUrl(configuredUrl)) {
    const h = await headers();
    const forwardedHost = h.get('x-forwarded-host')?.split(',')[0]?.trim();
    const host = forwardedHost || h.get('host');
    if (host) {
      const forwardedProto = h.get('x-forwarded-proto')?.split(',')[0]?.trim();
      const protocol = forwardedProto === 'https' || forwardedProto === 'http'
        ? forwardedProto
        : host.includes('localhost') || host.startsWith('127.')
          ? 'http'
          : 'https';
      siteUrl = `${protocol}://${host}`;
    }
  }

  const metadataBase = new URL(siteUrl);
  const shareImage = new URL('/assets/munjapay-og-v1.png', metadataBase).toString();

  return {
    metadataBase,
    title: { default: shareTitle, template: '%s | 문자페이' },
    description: shareDescription,
    keywords: ['문자페이', '문자결제', '포인트 충전', '간편결제', 'SMS 결제', '선불 충전'],
    icons: {
      icon: [
        { url: '/munjapay-mark.svg?v=1', type: 'image/svg+xml', sizes: 'any' },
      ],
      shortcut: '/munjapay-mark.svg?v=1',
    },
    openGraph: {
      title: shareTitle,
      description: shareDescription,
      type: 'website',
      url: metadataBase,
      siteName: '문자페이',
      locale: 'ko_KR',
      images: [{ url: shareImage, width: 1200, height: 630, alt: '문자페이 쉽고 빠른 문자결제' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: shareTitle,
      description: shareDescription,
      images: [shareImage],
    },
    robots: { index: true, follow: true },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#071426',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // suppressHydrationWarning: 번역기·다크모드·비밀번호 관리자 같은 브라우저 확장이
  // 하이드레이션 전에 <html>/<body> 속성을 주입해 발생하는 속성 불일치 경고를 막는다.
  // (한 단계 깊이의 속성에만 적용되므로 내부 콘텐츠의 실제 불일치는 계속 감지된다)
  return (
    <html lang="ko" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
