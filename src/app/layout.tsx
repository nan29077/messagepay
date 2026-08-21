import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './globals.css';

const shareTitle = '도네이도 | 문자 한 통이 방송을 움직입니다';
const shareDescription = '크리에이터에게 메시지를 보내고, 실시간으로 응원과 후원을 전달하는 문자 기반 후원 플랫폼입니다.';

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
  let siteUrl = configuredUrl || 'http://localhost:3025';

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
  const shareImage = new URL('/assets/donaido-og-share-v3.png', metadataBase).toString();

  return {
    metadataBase,
    title: { default: shareTitle, template: '%s | 도네이도' },
    description: shareDescription,
    keywords: ['도네이도', '문자후원', '크리에이터 후원', '라이브 방송', 'OBS 오버레이', 'TTS'],
    icons: {
      icon: [
        { url: '/favicon.ico?v=4', type: 'image/x-icon', sizes: '16x16 32x32 48x48 64x64' },
        { url: '/donaido-icon-v3.png', type: 'image/png', sizes: '512x512' },
      ],
      shortcut: '/favicon.ico?v=4',
      apple: '/apple-touch-icon-v3.png',
    },
    openGraph: {
      title: shareTitle,
      description: shareDescription,
      type: 'website',
      url: metadataBase,
      siteName: '도네이도 DONAIDO',
      locale: 'ko_KR',
      images: [{ url: shareImage, width: 1200, height: 630, alt: '도네이도 문자 후원 플랫폼' }],
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
  themeColor: '#fbb914',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
