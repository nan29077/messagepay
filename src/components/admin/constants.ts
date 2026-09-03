import { redirect } from 'next/navigation';
import type { ChargeStatus } from '@/generated/prisma/enums';

/** 결제가 실제로 승인된(=매출로 잡히는) 결제 상태 */
export const PAID_CHARGE_STATUSES: ChargeStatus[] = [
  'PAYMENT_SUCCESS',
  'BROADCAST_PENDING',
  'BROADCASTED',
  'PARTIAL_DELIVERY_FAILED',
  'SETTLEMENT_PENDING',
  'SETTLED',
];

export const PAGE_SIZE = 25;

export function parsePage(raw?: string): number {
  const n = Number.parseInt(raw ?? '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * 범위를 벗어난 page 파라미터를 마지막 페이지로 보정한다.
 *
 * 목록이 비면 Pager 도 함께 사라진다(빈 상태 분기 안에 있다). 그래서 `?page=999` 로 들어가면
 * "조건에 맞는 결과가 없습니다" 만 남고 돌아갈 링크가 없어, URL 을 직접 고치거나 초기화해야 했다.
 * 실제로는 데이터가 있는데 화면만 비어 보이는 상태를 만들지 않는다.
 *
 * 서버 컴포넌트에서 목록 조회 직후(lastPage 를 구한 뒤)에 호출한다.
 */
export function clampPage(input: {
  basePath: string;
  params: Record<string, string | undefined>;
  page: number;
  lastPage: number;
  total: number;
  /** 한 화면에 목록이 둘 이상일 때 페이지 파라미터 이름을 분리한다(Pager 와 같은 값). */
  pageParam?: string;
}): void {
  const { basePath, params, page, lastPage, total, pageParam = 'page' } = input;
  if (total <= 0 || page <= lastPage) return;

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '' && k !== pageParam) qs.set(k, v);
  }
  qs.set(pageParam, String(lastPage));
  redirect(`${basePath}?${qs.toString()}`);
}

/**
 * 관리자 등급별 실행 가능 여부.
 *
 * 서버 액션은 이미 등급을 검사해 거절하지만, 화면이 등급을 읽지 않으면 위험한 버튼이
 * 모두 활성 상태로 보인다. 눌러 본 뒤에야 "권한이 없습니다" 를 만나는 죽은 버튼이 된다.
 * 판정 기준은 서버 액션과 같아야 한다.
 */

/** 변경 동작 일반. `run()` 이 READ_ONLY 를 막는 것과 같은 기준. */
export function canWrite(permission?: string | null): boolean {
  return permission !== 'READ_ONLY';
}

/** 금전·정책 변경. 정산·환불·수수료·한도 액션이 SUPPORT 를 막는 것과 같은 기준. */
export function canManageMoney(permission?: string | null): boolean {
  return permission !== 'READ_ONLY' && permission !== 'SUPPORT';
}

/** 최고 관리자 전용(약관 등록, 문의 관리 등). */
export function isSuperAdmin(permission?: string | null): boolean {
  return permission === 'SUPER_ADMIN';
}

/** MT 메시지 본문처럼 최고관리자·운영만 다루는 영역. */
export function canManageTemplates(permission?: string | null): boolean {
  return permission === 'SUPER_ADMIN' || permission === 'OPERATION';
}
