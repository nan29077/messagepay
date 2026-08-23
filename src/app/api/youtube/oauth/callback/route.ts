import { prisma } from '@/server/db';
import { newId } from '@/lib/id';
import { encrypt, safeEqual, tokenHash } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { getSessionUser } from '@/server/auth';
import { getYouTubeAdapter } from '@/server/adapters/youtube';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 유튜브 OAuth 콜백.
 *
 * 보안
 *  - state 에 creatorId 를 담고, 세션의 크리에이터와 일치하는지 반드시 검증한다(CSRF 방지).
 *  - state 가 서명된 형태(`creatorId.signature`)면 서명도 함께 확인한다.
 *  - access/refresh 토큰은 평문 저장하지 않고 암호화해 보관하며 로그에 남기지 않는다.
 *
 * 현재는 mock 어댑터가 동작하며, 실제 구글 연동은 OAuth 클라이언트 승인 후 어댑터 교체로 전환된다.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (query: string) => Response.redirect(new URL(`/studio/youtube?${query}`, url.origin), 302);

  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') ?? '';

  if (error) return back('youtube=denied');
  if (!code) return back('youtube=invalid');

  const session = await getSessionUser();
  if (!session?.creatorId) {
    return Response.redirect(new URL('/login?next=/studio/youtube', url.origin), 302);
  }

  // state 검증
  const [stateCreatorId, signature] = state.split('.');
  if (!stateCreatorId || stateCreatorId !== session.creatorId) {
    return back('youtube=state_mismatch');
  }
  // 서명이 없는 state 는 거절한다. (서명 없이 creatorId 만으로 통과하면 공격자의 인증 코드가 담긴
  // 콜백 URL 을 피해자가 열었을 때 피해자 계정에 다른 채널이 연결된다)
  if (!signature || !safeEqual(tokenHash(stateCreatorId), signature)) {
    return back('youtube=state_mismatch');
  }
  const creatorId = session.creatorId;

  try {
    const adapter = getYouTubeAdapter();

    const exchanged = await adapter.exchangeCode(code);
    if (!exchanged.ok || !exchanged.data) {
      return back(`youtube=token_failed&code=${encodeURIComponent(exchanged.code ?? '')}`);
    }
    const tokens = exchanged.data;

    const channelRes = await adapter.getChannel(tokens.accessToken);
    if (!channelRes.ok || !channelRes.data) {
      return back(`youtube=channel_failed&code=${encodeURIComponent(channelRes.code ?? '')}`);
    }
    const channel = channelRes.data;

    const common = {
      channelId: channel.channelId,
      channelTitle: channel.title,
      channelThumb: channel.thumbnailUrl ?? null,
      accessTokenEnc: encrypt(tokens.accessToken),
      refreshTokenEnc: encrypt(tokens.refreshToken),
      scope: tokens.scope,
      expiresAt: tokens.expiresAt,
      status: 'CONNECTED' as const,
      lastError: null,
      lastCheckedAt: new Date(),
    };

    await prisma.youTubeConnection.upsert({
      where: { creatorId },
      create: { id: newId(), creatorId, ...common },
      update: common,
    });

    return back('youtube=connected');
  } catch (e) {
    // 토큰 값은 로그에 남기지 않는다.
    logger.warn('유튜브 연결 실패', { creatorId, message: (e as Error).message });
    return back('youtube=error');
  }
}
