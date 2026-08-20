import { env } from '@/lib/env';

/**
 * 상태를 바꾸는 라우트 핸들러용 동일 출처 검사 (CSRF 방어).
 *
 * 세션 쿠키가 SameSite=Lax 라 폼 POST 는 기본적으로 막히지 않는다.
 * 로그인/로그아웃처럼 외부 사이트에서 강제로 트리거되면 곤란한 라우트는
 * Origin(없으면 Referer)이 우리 호스트인지 반드시 확인한다.
 */

function hostOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

export function allowedHosts(req: Request): Set<string> {
  const hosts = new Set<string>();
  const base = hostOf(env.baseUrl);
  if (base) hosts.add(base);
  // 리버스 프록시 뒤에서도 동작하도록 실제 요청 호스트를 함께 허용한다.
  const forwarded = req.headers.get('x-forwarded-host');
  if (forwarded) hosts.add(forwarded.split(',')[0]!.trim());
  const hostHeader = req.headers.get('host');
  if (hostHeader) hosts.add(hostHeader);
  const self = hostOf(req.url);
  if (self) hosts.add(self);
  return hosts;
}

/** 동일 출처 요청이면 true. Origin·Referer 가 모두 없으면 거절한다(fail-closed). */
export function isSameOrigin(req: Request): boolean {
  const hosts = allowedHosts(req);
  const origin = hostOf(req.headers.get('origin'));
  if (origin) return hosts.has(origin);
  const referer = hostOf(req.headers.get('referer'));
  if (referer) return hosts.has(referer);
  return false;
}
