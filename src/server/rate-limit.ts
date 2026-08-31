import { headers } from 'next/headers';
import { kv } from '@/server/redis';

/**
 * IP 단위 속도 제한 공용 유틸.
 *
 * 대상은 "인증 없이 계정/자원을 만들 수 있는" 입구다.
 *  - 회원가입 / 가맹점 신청 : 계정 대량 생성 방지
 *  - 비밀번호 재설정 요청       : 메일 폭탄 · 계정 존재 여부 탐색 방지
 *
 * 규칙
 *  - 프록시가 붙인 주소를 알 수 없으면(로컬 직접 접속 등) 제한을 걸지 않는다.
 *    모든 클라이언트가 한 버킷을 공유해 서로를 잠그는 쪽이 더 위험하다.
 *  - 카운터는 Redis(없으면 인메모리)를 쓴다. 다중 인스턴스에서는 Redis 가 필요하다.
 *  - 실패해도 예외를 밖으로 던지지 않는다. 속도 제한 저장소 장애가 가입 자체를 막으면 안 된다.
 */

/** 신뢰 프록시가 붙인 마지막 홉의 주소만 사용한다. 헤더가 없으면 null. */
export function clientIpFrom(get: (name: string) => string | null): string | null {
  const xff = get('x-forwarded-for');
  if (xff) {
    const hops = xff.split(',').map((s) => s.trim()).filter(Boolean);
    return hops[hops.length - 1] ?? null;
  }
  return get('x-real-ip') ?? get('cf-connecting-ip');
}

export function clientIpFromRequest(req: Request): string | null {
  return clientIpFrom((name) => req.headers.get(name));
}

/** 서버 액션에서 호출자의 IP 를 얻는다. */
export async function clientIpFromHeaders(): Promise<string | null> {
  const h = await headers();
  return clientIpFrom((name) => h.get(name));
}

export interface RateLimitResult {
  ok: boolean;
  /** 현재 창에서의 시도 횟수. 제한을 적용하지 않은 경우 0. */
  count: number;
}

/**
 * 카운터를 1 증가시키고 상한을 넘었는지 판정한다.
 * key 가 비어 있으면(주소를 알 수 없으면) 항상 통과시킨다.
 */
export async function consumeRateLimit(
  scope: string,
  key: string | null | undefined,
  max: number,
  windowSec: number,
): Promise<RateLimitResult> {
  if (!key) return { ok: true, count: 0 };
  try {
    const count = await kv.incr(`rl:${scope}:${key}`, windowSec);
    return { ok: count <= max, count };
  } catch {
    return { ok: true, count: 0 };
  }
}

/** 서버 액션용 축약형. IP 를 알 수 없으면 통과한다. */
export async function consumeIpRateLimit(
  scope: string,
  max: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const ip = await clientIpFromHeaders();
  return consumeRateLimit(scope, ip, max, windowSec);
}
