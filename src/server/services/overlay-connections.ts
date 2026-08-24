import { logger } from '@/lib/logger';

/**
 * 오버레이 SSE 동시 연결 수 제한 (크리에이터 단위).
 *
 * OBS 는 장면 전환·새로 고침 때마다 브라우저 소스를 다시 띄우고, 스튜디오 미리보기도
 * 같은 스트림을 연다. 토큰이 유출되면 연결이 무제한으로 늘어 프로세스 메모리와
 * 파일 디스크립터를 갉아먹으므로 크리에이터당 상한을 둔다.
 *
 * 새 연결을 거절하지 않고 **가장 오래된 연결을 끊는다.**
 *  - 거절 방식은 OBS 가 죽어 아직 정리되지 않은 유령 연결이 남아 있을 때
 *    정상적인 재연결까지 막아 방송 중에 알림이 통째로 사라진다.
 *  - 방출된 쪽은 클라이언트가 지수 백오프로 다시 붙으므로 복구된다.
 *
 * 프로세스 단위 카운터다. 다중 인스턴스에서는 인스턴스별로 적용된다.
 */

/** 크리에이터 1명이 동시에 열어 둘 수 있는 오버레이 스트림 수 */
export const MAX_OVERLAY_CONNECTIONS = 3;

interface Connection {
  /** 방출(강제 종료) 콜백 */
  close: () => void;
  openedAt: number;
}

const globalForConn = globalThis as unknown as {
  overlayConnections?: Map<string, Set<Connection>>;
};

// 개발 서버(HMR)에서 모듈이 다시 로드돼도 같은 집합을 보도록 globalThis 에 보관한다.
const registry = globalForConn.overlayConnections ?? new Map<string, Set<Connection>>();
globalForConn.overlayConnections = registry;

/**
 * 연결을 등록한다. 상한을 넘으면 가장 오래된 연결을 끊는다.
 * @returns 등록 해제 함수 (연결 종료 시 반드시 호출한다)
 */
export function registerOverlayConnection(creatorId: string, close: () => void): () => void {
  const set = registry.get(creatorId) ?? new Set<Connection>();
  registry.set(creatorId, set);

  const conn: Connection = { close, openedAt: Date.now() };
  set.add(conn);

  while (set.size > MAX_OVERLAY_CONNECTIONS) {
    // Set 은 삽입 순서를 유지하므로 첫 항목이 가장 오래된 연결이다.
    const oldest = set.values().next().value;
    if (!oldest || oldest === conn) break;
    set.delete(oldest);
    logger.info('오버레이 동시 연결 상한 초과 — 가장 오래된 연결을 종료합니다.', {
      creatorId,
      limit: MAX_OVERLAY_CONNECTIONS,
      openedAt: new Date(oldest.openedAt).toISOString(),
    });
    try {
      oldest.close();
    } catch {
      /* 이미 닫힌 연결 */
    }
  }

  return () => {
    set.delete(conn);
    if (set.size === 0) registry.delete(creatorId);
  };
}

/** 현재 열려 있는 연결 수 (디버그/모니터링용) */
export function countOverlayConnections(creatorId: string): number {
  return registry.get(creatorId)?.size ?? 0;
}
