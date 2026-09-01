import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * 지급대행 어댑터.
 *
 * 정산금을 가맹점 계좌로 실제 이체하는 외부 서비스다.
 * 결제 어댑터와 같은 구조로, 실제 계약·키가 없으면 mock 으로만 동작하고
 * 화면과 로그에 mock 임을 명시한다(성공을 꾸며내지 않는다).
 *
 * 이중 지급 방지
 *   요청마다 `requestId` 를 멱등키로 넘긴다. 같은 키로 두 번 호출되면
 *   대행사는 새로 이체하지 않고 앞선 결과를 그대로 돌려줘야 한다.
 *   네트워크 오류로 결과를 못 받은 경우에는 inquire() 로 확정한다. 절대 재이체하지 않는다.
 */

export interface PayoutRequest {
  /** 정산 회차 ID. 멱등키로 그대로 쓴다. */
  requestId: string;
  merchantName: string;
  bankCode: string;
  /** 복호화된 계좌번호. 로그에 남기지 않는다. */
  accountNo: string;
  holderName: string;
  /** 실제 이체 금액(원천징수 제외) */
  amount: bigint;
  memo?: string;
}

export interface PayoutResult {
  ok: boolean;
  referenceNo?: string;
  /** 실패 사유 코드 (ACCOUNT_INVALID · HOLDER_MISMATCH · LIMIT · PROVIDER_ERROR · TIMEOUT) */
  code?: string;
  message: string;
  /** 결과를 확정하지 못했다. 조회로 확정해야 한다(재이체 금지). */
  unknown?: boolean;
  mock: boolean;
}

export interface PayoutAdapter {
  info(): { provider: string; mode: 'mock' | 'live'; missingCredentials: string[] };
  transfer(req: PayoutRequest): Promise<PayoutResult>;
  inquire(requestId: string): Promise<PayoutResult>;
}

const mockResults = new Map<string, PayoutResult>();

export function resetMockPayoutState() {
  mockResults.clear();
}

export const mockPayoutAdapter: PayoutAdapter = {
  info() {
    return { provider: 'mock', mode: 'mock', missingCredentials: [] };
  },

  async transfer(req) {
    const seen = mockResults.get(req.requestId);
    if (seen) return seen;

    let result: PayoutResult;
    if (req.accountNo.endsWith('0000')) {
      result = { ok: false, code: 'ACCOUNT_INVALID', message: '[MOCK] 계좌번호가 올바르지 않습니다.', mock: true };
    } else if (req.accountNo.endsWith('9999')) {
      result = { ok: false, code: 'TIMEOUT', message: '[MOCK] 응답을 받지 못했습니다.', unknown: true, mock: true };
    } else {
      result = {
        ok: true,
        referenceNo: `MOCKPAY-${req.requestId.slice(-10)}`,
        message: '[MOCK] 이체를 요청했습니다.',
        mock: true,
      };
    }

    mockResults.set(req.requestId, result);
    logger.warn('[MOCK] 지급대행 이체 — 실제 이체가 아닙니다.', {
      requestId: req.requestId,
      amount: req.amount.toString(),
      ok: result.ok,
    });
    return result;
  },

  async inquire(requestId) {
    const seen = mockResults.get(requestId);
    if (!seen) {
      return { ok: false, code: 'NOT_FOUND', message: '[MOCK] 이체 요청을 찾을 수 없습니다.', mock: true };
    }
    if (seen.unknown) {
      const settled: PayoutResult = {
        ok: true,
        referenceNo: `MOCKPAY-${requestId.slice(-10)}`,
        message: '[MOCK] 조회 결과 이체가 완료되어 있었습니다.',
        mock: true,
      };
      mockResults.set(requestId, settled);
      return settled;
    }
    return seen;
  },
};

export function getPayoutAdapter(): PayoutAdapter {
  if (env.payout.provider !== 'mock') {
    logger.warn('지급대행 실연동 어댑터가 아직 없어 mock 으로 처리합니다.', {
      provider: env.payout.provider,
    });
  }
  return mockPayoutAdapter;
}
