import { EventEmitter } from 'node:events';
import Redis from 'ioredis';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * 오버레이 실시간 이벤트 버스 (SSE 백엔드).
 *
 * - 단일 인스턴스: 인메모리 EventEmitter
 * - 다중 인스턴스(AWS ECS/EKS 등): Redis Pub/Sub 로 브로드캐스트
 *
 * 결제 성공 이벤트만 이 버스에 올린다. 결제 실패 건은 절대 올리지 않는다.
 */

export interface OverlayEventPayload {
  eventId: string;
  creatorId: string;
  donationId: string | null;
  donorName: string;
  amount: string;
  message: string;
  sticker: string;
  tts: {
    enabled: boolean;
    text: string;
    voice: string;
    speed: number;
    volume: number;
  } | null;
  durationMs: number;
  occurredAt: string;
  isTest: boolean;
}

const CHANNEL = 'tornado:overlay';

const globalForBus = globalThis as unknown as {
  overlayEmitter?: EventEmitter;
  overlayPub?: Redis;
  overlaySub?: Redis;
};

const emitter =
  globalForBus.overlayEmitter ??
  (() => {
    const e = new EventEmitter();
    e.setMaxListeners(0);
    return e;
  })();
globalForBus.overlayEmitter = emitter;

function ensureRedis() {
  if (!env.redisUrl) return;
  if (globalForBus.overlayPub && globalForBus.overlaySub) return;
  try {
    const pub = new Redis(env.redisUrl, { maxRetriesPerRequest: 2 });
    const sub = new Redis(env.redisUrl, { maxRetriesPerRequest: 2 });
    pub.on('error', (e: Error) => logger.warn('overlay pub error', { message: e.message }));
    sub.on('error', (e: Error) => logger.warn('overlay sub error', { message: e.message }));
    sub.subscribe(CHANNEL).catch((e: Error) => logger.warn('overlay subscribe 실패', { message: e.message }));
    sub.on('message', (_ch: string, raw: string) => {
      try {
        const payload = JSON.parse(raw) as OverlayEventPayload;
        emitter.emit(payload.creatorId, payload);
      } catch {
        /* ignore */
      }
    });
    globalForBus.overlayPub = pub;
    globalForBus.overlaySub = sub;
  } catch (e) {
    logger.warn('Overlay Redis 연결 실패. 인메모리 버스만 사용합니다.', { message: (e as Error).message });
  }
}

ensureRedis();

export function publishOverlayEvent(payload: OverlayEventPayload) {
  if (globalForBus.overlayPub) {
    globalForBus.overlayPub.publish(CHANNEL, JSON.stringify(payload)).catch(() => undefined);
  } else {
    emitter.emit(payload.creatorId, payload);
  }
}

export function subscribeOverlay(creatorId: string, handler: (p: OverlayEventPayload) => void): () => void {
  emitter.on(creatorId, handler);
  return () => emitter.off(creatorId, handler);
}
