'use server';

import { headers } from 'next/headers';
import { confirmChargeAmount } from '@/server/services/charge-select';

/**
 * 충전 금액 확정.
 *
 * 성공하면 결제사 PIN 입력 화면 주소를 돌려준다. 화면은 그 주소로 그대로 이동하므로
 * 이용자는 문자를 한 번 더 받지 않는다.
 */

export interface SelectAmountState {
  ok: boolean;
  message?: string;
  pinUrl?: string;
  mock?: boolean;
}

export async function confirmChargeAmountAction(
  _prev: SelectAmountState,
  formData: FormData,
): Promise<SelectAmountState> {
  const token = String(formData.get('token') ?? '');
  const productId = String(formData.get('productId') ?? '').trim();
  const customRaw = String(formData.get('customAmount') ?? '').replace(/[^\d]/g, '');

  if (!token) return { ok: false, message: '유효하지 않은 요청입니다.' };
  if (!productId && !customRaw) return { ok: false, message: '충전 금액을 선택해 주세요.' };
  if (!productId && !/^\d{3,9}$/.test(customRaw)) {
    return { ok: false, message: '충전 금액을 확인해 주세요.' };
  }

  const h = await headers();
  const result = await confirmChargeAmount({
    token,
    productId: productId || null,
    customAmount: productId ? null : BigInt(customRaw),
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    userAgent: h.get('user-agent') ?? undefined,
  });

  return {
    ok: result.ok,
    message: result.message,
    pinUrl: result.pinUrl,
    mock: result.mock,
  };
}
