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
 * 상한은 **연결 종류별로 따로** 센다.
 *  - broadcast : 토큰으로 붙은 실제 방송용 브라우저 소스(OBS · PRISM)
 *  - preview   : 스튜디오 미리보기(iframe · 새 탭). 세션으로 붙는다.
 * 하나로 묶어 세면 크리에이터가 스튜디오 미리보기를 몇 개 열어 두는 것만으로
 * 방송에 실제로 쓰이는 OBS 연결(가장 오래된 연결)이 끊긴다. 종류를 나눠 두면
 * 미리보기는 미리보기끼리만 밀어낸다.
 *
 * 프로세스 단위 카운터다. 다중 인스턴스에서는 인스턴스별로 적용된다.
 */

/** 크리에이터 1명이 같은 종류로 동시에 열어 둘 수 있는 오버레이 스트림 수 */
export const MAX_OVERLAY_CONNECTIONS = 3;

/** 연결 종류. 상한과 방출 대상은 같은 종류 안에서만 적용된다. */
export type OverlayConnectionKind = 'broadcast' | 'preview';

interface Connection {
  /** 방출(강제 종료) 콜백 */
  close: () => void;
  openedAt: number;
  kind: OverlayConnectionKind;
}

const globalForConn = globalThis as unknown as {
  overlayConnections?: Map<string, Set<Connection>>;
};

// 개발 서버(HMR)에서 모듈이 다시 로드돼도 같은 집합을 보도록 globalThis 에 보관한다.
const registry = globalForConn.overlayConnections ?? new Map<string, Set<Connection>>();
globalForConn.overlayConnections = registry;

/** 같은 종류의 연결을 오래된 순서로 모은다. Set 은 삽입 순서를 유지한다. */
function sameKind(set: Set<Connection>, kind: OverlayConnectionKind): Connection[] {
  return [...set].filter((c) => c.kind === kind);
}

/**
 * 연결을 등록한다. 같은 종류의 연결이 상한을 넘으면 그중 가장 오래된 연결을 끊는다.
 * @returns 등록 해제 함수 (연결 종료 시 반드시 호출한다)
 */
export function registerOverlayConnection(
  creatorId: string,
  close: () => void,
  kind: OverlayConnectionKind = 'broadcast',
): () => void {
  const set = registry.get(creatorId) ?? new Set<Connection>();
  registry.set(creatorId, set);

  const conn: Connection = { close, openedAt: Date.now(), kind };
  set.add(conn);

  for (;;) {
    const peers = sameKind(set, kind);
    if (peers.length <= MAX_OVERLAY_CONNECTIONS) break;
    const oldest = peers[0];
    if (!oldest || oldest === conn) break;
    set.delete(oldest);
    logger.info('오버레이 동시 연결 상한 초과 — 가장 오래된 연결을 종료합니다.', {
      creatorId,
      kind,
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

/**
 * 현재 열려 있는 연결 수 (디버그/모니터링용).
 * 기본값은 방송용(OBS · PRISM)만 센다. 스튜디오의 [현재 연결] 배지가
 * 자기 미리보기 창까지 세어 실제로 방송에 붙어 있는 것처럼 보이면 안 된다.
 */
export function countOverlayConnections(
  creatorId: string,
  kind: OverlayConnectionKind = 'broadcast',
): number {
  const set = registry.get(creatorId);
  return set ? sameKind(set, kind).length : 0;
}
