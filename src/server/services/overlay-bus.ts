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
  /// 금액 구간에서 고른 파티클 효과 (NONE | HEART | STAR | FIREWORK | CONFETTI | COIN)
  effect: string;
  /// 후원자명 + 메시지 배너를 띄울지 여부
  banner: boolean;
  /// 적용된 금액 구간 이름. 구간을 쓰지 않으면 빈 문자열.
  tierLabel: string;
  tts: {
    enabled: boolean;
    text: string;
    voice: string;
    speed: number;
    pitch: number;
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
        // 이 프로세스에서 이미 로컬로 전달한 이벤트가 Redis 를 거쳐 되돌아온 경우 중복 재생을 막는다.
        if (recentLocalEventIds.has(payload.eventId)) return;
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

/**
 * 이 프로세스가 직접 발행한 이벤트 ID 기록.
 * Redis Pub/Sub 로 자기 자신에게 되돌아온 메시지를 중복 재생하지 않기 위해 사용한다.
 */
const recentLocalEventIds = new Set<string>();
const RECENT_LOCAL_MAX = 1000;

export function publishOverlayEvent(payload: OverlayEventPayload) {
  // 항상 로컬 구독자(같은 프로세스의 SSE 연결)에게 즉시 전달한다.
  // 기존에는 REDIS_URL 이 설정돼 있으면 Redis 로만 발행했는데, Redis 서버가 내려가 있으면
  // publish 실패가 조용히 무시되어 오버레이가 아무 이벤트도 받지 못했다.
  // 로컬 전달을 기본으로 하고, Redis 는 다중 인스턴스 브로드캐스트 용도로만 추가 발행한다.
  recentLocalEventIds.add(payload.eventId);
  if (recentLocalEventIds.size > RECENT_LOCAL_MAX) {
    const oldest = recentLocalEventIds.values().next().value;
    if (oldest) recentLocalEventIds.delete(oldest);
  }
  emitter.emit(payload.creatorId, payload);

  globalForBus.overlayPub?.publish(CHANNEL, JSON.stringify(payload)).catch(() => undefined);
}

export function subscribeOverlay(creatorId: string, handler: (p: OverlayEventPayload) => void): () => void {
  emitter.on(creatorId, handler);
  return () => emitter.off(creatorId, handler);
}
