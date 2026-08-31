import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * 충전 반영 어댑터.
 *
 * 결제가 승인된 뒤 가맹 서비스에 "누구에게 얼마를 충전하라" 고 알리는 서버 대 서버 연동이다.
 * 결제 금액과 지급 포인트는 1:1 이므로 금액 하나만 넘긴다.
 *
 * 계정 식별
 *   이용자의 **휴대폰 번호**로 가맹 서비스의 회원을 찾는다(2026-08-31 결정).
 *   문자를 보낸 번호가 곧 결제한 사람이고, 가맹 서비스도 같은 번호로 회원을 식별한다는 전제다.
 *   번호로 회원을 찾지 못하면 가맹 서비스가 NOT_FOUND 를 돌려주고, 그 건은 반영 실패로 남아
 *   관리자가 수동 처리한다. 결제를 되돌리지는 않는다(환불은 별도 절차다).
 *
 * 절대 규칙
 *   반영 실패는 결제 결과를 바꾸지 않는다. 결제는 이미 승인·정산된 사실이고,
 *   반영은 그 뒤에 따라오는 별도 사건이다. 실패는 상태로 남겨 재시도·수동 처리로 푼다.
 *
 * 실제 계약 전에는 mock 만 동작하며, 성공을 꾸며내지 않고 mock 임을 로그와 화면에 남긴다.
 */

export interface ChargeReflectInput {
  /** 결제 건 ID (가맹 서비스가 중복 반영을 막는 멱등키로 쓴다) */
  chargeId: string;
  /** 대외 노출용 거래번호 */
  transactionNo: string;
  /** 가맹점 코드 */
  merchantCode: string;
  /** 이용자 휴대폰 번호(정규화된 원문). 가맹 서비스가 이 번호로 회원을 찾는다. */
  phone: string;
  /** 충전 금액(원) = 지급 포인트 */
  amount: bigint;
}

export interface ChargeReflectResult {
  ok: boolean;
  /** 실패 사유 코드 (NOT_FOUND · REJECTED · TIMEOUT · ERROR) */
  code?: string;
  message: string;
  /** 가맹 서비스가 돌려준 처리 번호 */
  referenceNo?: string;
  /** 실제 연동이 아닌 mock 처리인지 */
  mock: boolean;
}

export interface ChargeReflectAdapter {
  info(): { provider: string; mode: 'mock' | 'live'; missingCredentials: string[] };
  reflect(input: ChargeReflectInput): Promise<ChargeReflectResult>;
}

export const mockChargeReflectAdapter: ChargeReflectAdapter = {
  info() {
    return { provider: 'mock', mode: 'mock', missingCredentials: [] };
  },
  async reflect(input) {
    // mock 규칙: 번호가 0000 으로 끝나면 회원을 찾지 못한 상황을 재현한다.
    if (input.phone.endsWith('0000')) {
      return { ok: false, code: 'NOT_FOUND', message: '[MOCK] 가맹 서비스에서 회원을 찾지 못했습니다.', mock: true };
    }
    logger.warn('[MOCK] 충전 반영 — 실제 가맹 서비스 연동이 아닙니다.', {
      chargeId: input.chargeId,
      merchantCode: input.merchantCode,
      amount: input.amount.toString(),
    });
    return {
      ok: true,
      message: '[MOCK] 충전 반영을 요청했습니다.',
      referenceNo: `MOCKREF-${input.transactionNo}`,
      mock: true,
    };
  },
};

export function getChargeReflectAdapter(): ChargeReflectAdapter {
  // 실연동 어댑터가 생기기 전까지는 mock 만 있다.
  // 계약이 끝나면 여기서 provider 별 구현을 고른다.
  if (env.chargeReflect.provider !== 'mock') {
    logger.warn('충전 반영 실연동 어댑터가 아직 없어 mock 으로 처리합니다.', {
      provider: env.chargeReflect.provider,
    });
  }
  return mockChargeReflectAdapter;
}
