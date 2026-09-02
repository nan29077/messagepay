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
