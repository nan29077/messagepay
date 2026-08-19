import type { Metadata, Viewport } from 'next';
import './globals.css';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_BASE_URL || 'http://localhost:3025';
const shareTitle = '토네이도 | 문자 한 통이 방송을 움직입니다';
const shareDescription = '크리에이터에게 메시지를 보내고, 실시간으로 응원과 후원을 전달하는 문자 기반 후원 플랫폼입니다.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: shareTitle, template: '%s | 토네이도' },
  description:
    shareDescription,
  keywords: ['토네이도', '문자후원', '크리에이터 후원', '라이브 방송', 'OBS 오버레이', 'TTS'],
  icons: {
    icon: [{ url: '/tornado-icon-v2.png', type: 'image/png', sizes: '512x512' }],
    shortcut: '/tornado-icon-v2.png',
    apple: '/apple-touch-icon-v2.png',
  },
  openGraph: {
    title: shareTitle,
    description: shareDescription,
    type: 'website',
    siteName: '토네이도 TORNADO',
    locale: 'ko_KR',
    images: [{ url: '/assets/tornado-og-share-v1.png', width: 1200, height: 630, alt: '토네이도 문자 후원 플랫폼' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: shareTitle,
    description: shareDescription,
    images: ['/assets/tornado-og-share-v1.png'],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#6c4cf1',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
