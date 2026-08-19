import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '토네이도 TORNADO | 문자 한 통이 방송을 움직입니다',
  description:
    '크리에이터에게 메시지를 보내고, 실시간으로 응원과 후원을 전달하세요. 문자 기반 크리에이터 후원 플랫폼 토네이도.',
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
