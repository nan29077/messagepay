import { prisma } from '@/server/db';
import { authorizeOverlay } from '@/server/services/overlay-access';
import { findOverlayTtsGrant } from '@/server/services/overlay-bus';
import { consumeRateLimit } from '@/server/rate-limit';
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
 *   GET /api/tts/synthesize?creatorId=...&token=...&eventId=...
 *
 * 규칙
 *  - 오버레이 토큰(또는 스튜디오 미리보기 세션)으로만 접근할 수 있다.
 *  - **읽을 문장은 요청자가 정하지 않는다.** 실제로 발행된 오버레이 이벤트의 문장만 합성한다.
 *    예전에는 text 를 쿼리로 그대로 받았는데, 오버레이 토큰은 OBS 브라우저 소스 URL 에
 *    늘 노출되는 값이라 그것을 아는 사람이 아무 문장이나 무제한으로 유료 합성시킬 수 있었고
 *    (크리에이터의 클로바 API 가 호출 수만큼 과금된다), 후원 메시지에 적용한 금칙어도
 *    이 경로에서는 아무 의미가 없었다.
 *  - 크리에이터가 고른 제공사가 서버 합성이 아니면 400 으로 거절한다.
 *    (오버레이 클라이언트는 실패 시 브라우저 음성으로 되돌아간다)
 *  - 합성 실패는 결제/방송 상태에 영향을 주지 않는다.
 */

/** 한 크리에이터가 1분에 요청할 수 있는 합성 횟수. 재생 실패 재시도까지 감안한 값이다. */
const RATE_MAX_PER_MIN = 60;

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const creatorId = sp.get('creatorId') ?? '';
  const token = sp.get('token') ?? '';
  const preview = sp.get('preview') === '1';
  const eventId = sp.get('eventId') ?? '';

  if (!creatorId || !eventId || (!preview && !token)) {
    return new Response('unauthorized', { status: 401 });
  }

  const access = await authorizeOverlay(creatorId, token, preview);
  if (!access.ok) {
    return new Response('unauthorized', { status: 401 });
  }

  // 토큰이 유출되더라도 과금이 폭주하지 않도록 한 겹 더 둔다.
  const rate = await consumeRateLimit('tts', creatorId, RATE_MAX_PER_MIN, 60);
  if (!rate.ok) {
    return new Response('too many requests', { status: 429 });
  }

  // 서버가 기억해 둔 문장만 합성한다. 모르는 이벤트면 클라이언트가 브라우저 음성으로 되돌아간다.
  const grant = findOverlayTtsGrant(eventId, creatorId);
  if (!grant) {
    return new Response('unknown event', { status: 404 });
  }

  const setting = await prisma.ttsSetting.findUnique({
    where: { creatorId },
    select: { provider: true },
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
    text: grant.text,
    speaker: grant.voice,
    speed: grant.speed,
    volume: grant.volume,
    pitch: grant.pitch,
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
