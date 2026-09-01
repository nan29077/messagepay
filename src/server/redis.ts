import Redis from 'ioredis';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Redis (ElastiCache) 클라이언트.
 * 로컬/테스트에서 Redis 가 없을 때는 인메모리 폴백을 사용한다.
 * 운영에서는 ALLOW_INMEMORY_FALLBACK=false 로 두어 폴백을 금지한다.
 */

export interface KvStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec?: number): Promise<void>;
  incr(key: string, ttlSec?: number): Promise<number>;
  del(key: string): Promise<void>;
  /** 원자적 선점. 이미 존재하면 false */
  setnx(key: string, value: string, ttlSec: number): Promise<boolean>;
}

class MemoryStore implements KvStore {
  private map = new Map<string, { v: string; exp: number }>();

  private alive(key: string) {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.exp && e.exp < Date.now()) {
      this.map.delete(key);
      return null;
    }
    return e;
  }

  async get(key: string) {
    return this.alive(key)?.v ?? null;
  }

  async set(key: string, value: string, ttlSec?: number) {
    this.map.set(key, { v: value, exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 });
  }

  async incr(key: string, ttlSec?: number) {
    const cur = Number((await this.get(key)) ?? 0) + 1;
    const existing = this.alive(key);
    this.map.set(key, {
      v: String(cur),
      exp: existing?.exp || (ttlSec ? Date.now() + ttlSec * 1000 : 0),
    });
    return cur;
  }

  async del(key: string) {
    this.map.delete(key);
  }

  async setnx(key: string, value: string, ttlSec: number) {
    if (this.alive(key)) return false;
    await this.set(key, value, ttlSec);
    return true;
  }
}

/**
 * Redis 스토어.
 * 개발 환경에서 Redis 가 떠 있지 않아도 앱이 죽지 않도록,
 * 명령 실패 시 인메모리 스토어로 자동 강등한다(운영에서는 폴백 금지).
 */
/** 폴백으로 내려간 뒤 Redis 를 다시 시도하기까지의 시간. */
const FALLBACK_RETRY_MS = 30_000;

class RedisStore implements KvStore {
  private fallback: MemoryStore | null = null;
  private fallbackUntil = 0;

  constructor(private client: Redis) {}

  /**
   * 지금 폴백을 써야 하는지.
   *
   * 한 번 강등되면 영원히 인메모리로 도는 구조였다. Redis 가 복구돼도 프로세스를
   * 재시작하기 전까지 속도 제한·재전송 방어·배치 잠금이 인스턴스별로 쪼개진 채 남는다.
   * 일정 시간이 지나면 다시 Redis 를 시도한다.
   */
  private useFallback(): MemoryStore | null {
    if (!this.fallback) return null;
    if (Date.now() >= this.fallbackUntil) {
      logger.info('Redis 재시도 — 인메모리 폴백을 해제합니다.');
      this.fallback = null;
      return null;
    }
    return this.fallback;
  }

  /** 현재 인메모리 폴백으로 동작 중인지(헬스체크에서 노출한다). */
  isDegraded(): boolean {
    return Boolean(this.fallback) && Date.now() < this.fallbackUntil;
  }

  private degrade(e: unknown): MemoryStore {
    if (!env.allowInMemoryFallback) throw e;
    if (!this.fallback) {
      logger.error('Redis 명령 실패. 인메모리 폴백으로 전환합니다(개발 전용).', {
        message: (e as Error)?.message,
      });
      this.fallback = new MemoryStore();
    }
    this.fallbackUntil = Date.now() + FALLBACK_RETRY_MS;
    return this.fallback;
  }

  async get(key: string) {
    const fb = this.useFallback();
    if (fb) return fb.get(key);
    try {
      return await this.client.get(key);
    } catch (e) {
      return this.degrade(e).get(key);
    }
  }

  async set(key: string, value: string, ttlSec?: number) {
    const fb = this.useFallback();
    if (fb) return fb.set(key, value, ttlSec);
    try {
      if (ttlSec) await this.client.set(key, value, 'EX', ttlSec);
      else await this.client.set(key, value);
    } catch (e) {
      await this.degrade(e).set(key, value, ttlSec);
    }
  }

  async incr(key: string, ttlSec?: number) {
    const fb = this.useFallback();
    if (fb) return fb.incr(key, ttlSec);
    try {
      const n = await this.client.incr(key);
      if (n === 1 && ttlSec) await this.client.expire(key, ttlSec);
      return n;
    } catch (e) {
      return this.degrade(e).incr(key, ttlSec);
    }
  }

  async del(key: string) {
    const fb = this.useFallback();
    if (fb) return fb.del(key);
    try {
      await this.client.del(key);
    } catch (e) {
      await this.degrade(e).del(key);
    }
  }

  async setnx(key: string, value: string, ttlSec: number) {
    const fb = this.useFallback();
    if (fb) return fb.setnx(key, value, ttlSec);
    try {
      const r = await this.client.set(key, value, 'EX', ttlSec, 'NX');
      return r === 'OK';
    } catch (e) {
      return this.degrade(e).setnx(key, value, ttlSec);
    }
  }
}

const globalForKv = globalThis as unknown as { kv?: KvStore; redis?: Redis };

function build(): KvStore {
  if (!env.redisUrl) {
    if (!env.allowInMemoryFallback) throw new Error('REDIS_URL 이 필요합니다.');
    logger.warn('REDIS_URL 미설정. 인메모리 폴백을 사용합니다.');
    return new MemoryStore();
  }
  try {
    const client = new Redis(env.redisUrl, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
      // 오프라인 큐를 끄면 연결 불가 시 즉시 에러가 나므로 폴백이 빠르게 동작한다
      enableOfflineQueue: !env.allowInMemoryFallback,
      retryStrategy: (times) => (times > 5 ? null : Math.min(times * 300, 2000)),
    });
    client.on('error', (e: Error) => logger.warn('redis error', { message: e.message }));
    globalForKv.redis = client;
    return new RedisStore(client);
  } catch (e) {
    if (!env.allowInMemoryFallback) throw e;
    logger.warn('Redis 연결 실패. 인메모리 폴백을 사용합니다.');
    return new MemoryStore();
  }
}

export const kv: KvStore = globalForKv.kv ?? build();
if (process.env.NODE_ENV !== 'production') globalForKv.kv = kv;
