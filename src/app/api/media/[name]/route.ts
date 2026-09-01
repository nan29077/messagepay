import { getObject } from '@/server/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 업로드된 이미지 서빙.
 *
 * next start 는 빌드 이후 public/ 에 추가된 파일을 서빙하지 않으므로,
 * 런타임 업로드 파일은 이 라우트로 직접 읽어 내려준다.
 * 저장 위치(로컬 디스크 / S3)는 server/uploads.ts 드라이버가 처리하므로
 * 이 라우트는 그대로 두고 STORAGE_DRIVER 만 바꾸면 된다.
 */
const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;

  // 경로 조작 방지: 허용된 파일명 형식만 받는다.
  if (!/^[a-f0-9]{32}\.(jpg|jpeg|png|webp|gif)$/i.test(name)) {
    return new Response('Not found', { status: 404 });
  }

  const ext = name.split('.').pop()!.toLowerCase();
  const buf = await getObject(name);
  if (!buf) return new Response('Not found', { status: 404 });

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      // 업로드 검사는 매직바이트만 보므로 'GIF89a' 로 시작하는 HTML 폴리글롯이 통과할 수 있다.
      // 스니핑을 끄고 문서로 해석될 여지를 없앤다(세션 쿠키가 같은 origin 이다).
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
