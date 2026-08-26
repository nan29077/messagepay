import { prisma } from '@/server/db';
import { authorizeOverlay } from '@/server/services/overlay-access';
import {
  normalizeTtsProvider,
  resolveNaverCredentials,
  synthesizeWithNaver,
} from '@/server/services/tts/naver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 서버 TTS 합성 (오버레이 전용).
 *
 *   GET /api/tts/synthesize?creatorId=...&token=...&text=...
 *
 * 규칙
 *  - 오버레이 토큰(또는 스튜디오 미리보기 세션)으로만 접근할 수 있다.
 *  - 크리에이터가 고른 제공사가 서버 합성이 아니면 400 으로 거절한다.
 *    (오버레이 클라이언트는 실패 시 브라우저 음성으로 되돌아간다)
 *  - 합성 실패는 결제/방송 상태에 영향을 주지 않는다.
 */

/** 한 번에 합성할 최대 글자 수. TtsSetting.maxChars 상한(200)보다 넉넉하게 잡는다. */
const MAX_TEXT = 300;

function clamp(value: string | null, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const creatorId = sp.get('creatorId') ?? '';
  const token = sp.get('token') ?? '';
  const preview = sp.get('preview') === '1';
  const text = (sp.get('text') ?? '').slice(0, MAX_TEXT).trim();

  if (!creatorId || (!preview && !token)) {
    return new Response('unauthorized', { status: 401 });
  }
  if (!text) {
    return new Response('bad request', { status: 400 });
  }

  const access = await authorizeOverlay(creatorId, token, preview);
  if (!access.ok) {
    return new Response('unauthorized', { status: 401 });
  }

  const setting = await prisma.ttsSetting.findUnique({
    where: { creatorId },
    select: { provider: true, voice: true },
  });
  const provider = normalizeTtsProvider(setting?.provider);
  if (provider !== 'naver') {
    return new Response('server tts disabled', { status: 400 });
  }

  const cred = await resolveNaverCredentials(creatorId);
  if (!cred) {
    return new Response('tts credentials missing', { status: 503 });
  }

  const result = await synthesizeWithNaver(cred, {
    text,
    speaker: sp.get('voice') || setting?.voice || '',
    speed: clamp(sp.get('speed'), 0.5, 2, 1),
    volume: clamp(sp.get('volume'), 0, 1, 1),
    pitch: clamp(sp.get('pitch'), 0, 2, 1),
  });

  if (!result.ok || !result.audio) {
    return new Response(result.message ?? 'tts failed', { status: 502 });
  }

  return new Response(result.audio, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(result.audio.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
