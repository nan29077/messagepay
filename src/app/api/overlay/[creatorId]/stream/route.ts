import { prisma } from '@/server/db';
import { logger } from '@/lib/logger';
import { subscribeOverlay, type OverlayEventPayload } from '@/server/services/overlay-bus';
import { authorizeOverlay } from '@/server/services/overlay-access';
import { registerOverlayConnection } from '@/server/services/overlay-connections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 오버레이 실시간 이벤트 (SSE).
 * OBS / PRISM 브라우저 소스가 이 스트림을 구독한다.
 * 토큰이 없거나 틀리면 즉시 거절한다.
 * preview=1 은 스튜디오 미리보기 전용으로, 로그인한 본인 크리에이터만 통과한다.
 *
 * 끊김 복구
 *  - 각 donation 이벤트에 `id: <eventId>` 를 붙인다.
 *  - 재연결 시 클라이언트가 마지막으로 받은 이벤트 ID 를 보내면(Last-Event-ID 헤더 또는
 *    lastEventId 쿼리) 그 이후에 쌓인 OverlayEvent 를 즉시 재전송한다.
 *  - 재전송 대상은 **최근 5분 이내**로 제한한다. 방송이 끝난 뒤 몇 시간 만에 다시 연결했을 때
 *    옛날 후원 알림이 한꺼번에 쏟아지면 안 된다.
 */

/** 재전송 대상 시간창. 이보다 오래된 이벤트는 무시한다. */
const REPLAY_WINDOW_MS = 5 * 60 * 1000;
/** 한 번에 재전송할 최대 건수. 넘치면 최신 건만 보낸다. */
const REPLAY_MAX = 20;

/** 재연결 클라이언트가 알려 준 마지막 이벤트 ID. 없으면 빈 문자열. */
function readLastEventId(req: Request, sp: URLSearchParams): string {
  // 브라우저가 자동 재연결할 때는 헤더로, 클라이언트가 직접 다시 연결할 때는 쿼리로 온다.
  const header = req.headers.get('last-event-id') ?? '';
  const value = header || sp.get('lastEventId') || '';
  // ULID 형식만 받는다. 임의 문자열로 DB 를 긁게 하지 않는다.
  return /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(value.trim()) ? value.trim() : '';
}

/**
 * 마지막으로 받은 이벤트 이후에 쌓인 이벤트를 찾는다.
 *
 * 앵커(마지막 이벤트)를 찾지 못하거나 이미 5분보다 오래됐으면 최근 5분만 대상으로 한다.
 * 다른 크리에이터의 이벤트 ID 를 보내 남의 알림을 훔쳐보는 것을 막기 위해 앵커의
 * creatorId 가 일치할 때만 앵커로 인정한다.
 */
async function loadMissedEvents(creatorId: string, lastEventId: string) {
  const since = new Date(Date.now() - REPLAY_WINDOW_MS);

  const anchor = await prisma.overlayEvent.findUnique({
    where: { id: lastEventId },
    select: { creatorId: true, createdAt: true },
  });
  const after = anchor && anchor.creatorId === creatorId && anchor.createdAt > since ? anchor.createdAt : since;

  // 최신 건이 더 중요하므로 내림차순으로 잘라낸 뒤 시간순으로 되돌린다.
  const rows = await prisma.overlayEvent.findMany({
    where: { creatorId, createdAt: { gt: after } },
    orderBy: { createdAt: 'desc' },
    take: REPLAY_MAX,
    select: { id: true, payload: true },
  });
  return rows.reverse();
}

export async function GET(req: Request, ctx: { params: Promise<{ creatorId: string }> }) {
  const { creatorId } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const token = sp.get('token') ?? '';
  const preview = sp.get('preview') === '1';

  // 토큰도 미리보기 표시도 없는 요청은 어차피 통과할 수 없다.
  // DB 조회 전에 잘라내 미인증 트래픽이 커넥션 풀을 먹는 것을 막는다.
  if (!preview && !token) {
    return new Response('unauthorized', { status: 401 });
  }

  const access = await authorizeOverlay(creatorId, token, preview);
  if (!access.ok) {
    return new Response('unauthorized', { status: 401 });
  }

  const lastEventId = readLastEventId(req, sp);

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let unregister: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const teardown = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        unregister?.();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const send = (event: string, data: unknown, id?: string) => {
        if (closed) return;
        try {
          const head = id ? `id: ${id}\n` : '';
          controller.enqueue(encoder.encode(`${head}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* 연결 종료 */
        }
      };

      // 동시 연결 상한. 상한을 넘으면 가장 오래된 연결이 여기서 끊긴다.
      unregister = registerOverlayConnection(creatorId, teardown);

      send('ready', { creatorId, at: new Date().toISOString(), resumed: Boolean(lastEventId) });

      // 재전송 중에 도착한 실시간 이벤트는 잠시 모아 두었다가 재전송 뒤에 이어 보낸다.
      // (구독을 먼저 걸어야 조회하는 사이에 들어온 후원이 사라지지 않는다)
      let replaying = Boolean(lastEventId);
      const buffered: OverlayEventPayload[] = [];

      unsubscribe = subscribeOverlay(creatorId, (payload) => {
        if (replaying) {
          buffered.push(payload);
          return;
        }
        send('donation', payload, payload.eventId);
      });

      if (lastEventId) {
        void (async () => {
          try {
            const missed = await loadMissedEvents(creatorId, lastEventId);
            if (missed.length > 0) {
              logger.info('오버레이 재연결 — 놓친 이벤트를 재전송합니다.', {
                creatorId,
                count: missed.length,
              });
            }
            for (const row of missed) send('donation', row.payload, row.id);
          } catch (e) {
            // 재전송 실패가 실시간 구독까지 막지는 않는다.
            logger.warn('오버레이 재전송 실패', { creatorId, message: (e as Error).message });
          } finally {
            replaying = false;
            for (const payload of buffered) send('donation', payload, payload.eventId);
            buffered.length = 0;
          }
        })();
      }

      // 프록시 타임아웃 방지용 하트비트
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          /* 연결 종료 */
        }
      }, 20000);

      req.signal.addEventListener('abort', teardown);
    },
    cancel() {
      closed = true;
      unsubscribe?.();
      unregister?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
