import { prisma } from '@/server/db';
import { safeEqual, tokenHash } from '@/lib/crypto';
import { getSessionUser } from '@/server/auth';

/**
 * 오버레이 접근 권한 판정.
 *
 * 두 가지 경로만 허용한다.
 *  1) 토큰 경로 — OBS / PRISM 브라우저 소스가 쓰는 정상 경로. tokenHash 대조.
 *  2) 미리보기 경로 — 스튜디오에 로그인한 본인 크리에이터만. 토큰을 화면에 다시 노출하지
 *     않기 위해(원문은 저장하지 않는다) 세션으로 판정한다. 이 경로는 방송에 쓰지 않는다.
 *
 * 미리보기에서는 오버레이 설정이 아직 없거나 꺼져 있어도 화면을 그린다.
 * URL 발급 전에도 효과를 확인할 수 있어야 하기 때문이다.
 */

export interface OverlayAccess {
  ok: boolean;
  preview: boolean;
  setting: Awaited<ReturnType<typeof prisma.overlaySetting.findUnique>>;
}

export async function authorizeOverlay(
  creatorId: string,
  token: string,
  preview: boolean,
): Promise<OverlayAccess> {
  const setting = await prisma.overlaySetting.findUnique({ where: { creatorId } });

  if (preview) {
    const session = await getSessionUser().catch(() => null);
    const mine = Boolean(session?.creatorId && session.creatorId === creatorId);
    return { ok: mine, preview: true, setting: mine ? setting : null };
  }

  const ok = Boolean(setting && token && safeEqual(setting.tokenHash, tokenHash(token)));
  return { ok, preview: false, setting: ok ? setting : null };
}
