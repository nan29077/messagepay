import { prisma } from '@/server/db';
import { tokenHash } from '@/lib/crypto';
import { subscribeOverlay } from '@/server/services/overlay-bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 오버레이 실시간 이벤트 (SSE).
 * OBS / PRISM 브라우저 소스가 이 스트림을 구독한다.
 * 토큰이 없거나 틀리면 즉시 거절한다.
 */
export async function GET(req: Request, ctx: { params: Promise<{ creatorId: string }> }) {
  const { creatorId } = await ctx.params;
  const token = new URL(req.url).searchParams.get('token') ?? '';

  const setting = await prisma.overlaySetting.findUnique({ where: { creatorId } });
  if (!setting || setting.tokenHash !== tokenHash(token)) {
    return new Response('unauthorized', { status: 401 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send('ready', { creatorId, at: new Date().toISOString() });

      unsubscribe = subscribeOverlay(creatorId, (payload) => {
        try {
          send('donation', payload);
        } catch {
          /* 연결 종료 */
        }
      });

      // 프록시 타임아웃 방지용 하트비트
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          /* 연결 종료 */
        }
      }, 20000);

      req.signal.addEventListener('abort', () => {
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      unsubscribe?.();
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
