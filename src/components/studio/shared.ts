import type { ChargeStatus } from '@/generated/prisma/enums';

/**
 * 가맹점 관리자 공용 상수/헬퍼.
 * (공용 lib 을 수정하지 않기 위해 studio 전용으로 분리한다)
 */

/** 결제가 승인되어 정산 대상이 되는 결제 상태 */
export const PAID_STATUSES: ChargeStatus[] = [
  'PAYMENT_SUCCESS',
  'BROADCAST_PENDING',
  'BROADCASTED',
  'PARTIAL_DELIVERY_FAILED',
  'SETTLEMENT_PENDING',
  'SETTLED',
];

export type SearchParamsRecord = Record<string, string | string[] | undefined>;

export function one(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? '';
  return v ?? '';
}

/** 쿼리스트링을 유지하면서 일부 값만 바꾼다 */
export function buildQuery(base: Record<string, string>, patch: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) {
    if (v) sp.set(k, v);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === '') sp.delete(k);
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}
