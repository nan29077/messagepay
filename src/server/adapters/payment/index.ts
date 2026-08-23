import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { AdapterNotConfiguredError, type AdapterInfo, type ProviderResult } from '../types';
// hecto.ts 는 이 파일에서 '타입만' 가져오므로 런타임 순환 참조는 생기지 않는다.
import { hectoPaymentAdapter } from './hecto';

/**
 * 결제 어댑터 (헥토파이낸셜 내통장결제 EzAuth 기준 인터페이스).
 *
 * 실제 흐름
 *   1) 결제창에서 계좌 인증 + 출금이체 등록  → createRegistrationSession / completeRegistration
 *   2) 빌키(자동결제 키) 발급               → completeRegistration 결과
 *   3) MO 수신 시 빌키로 승인               → approve
 *   4) 타임아웃 시 거래결과조회로 확정      → inquire
 *   5) 취소/환불                            → cancel
 *
 * 주의: 헥토 공식 제약상 결제인증 완료 후 10분 이내에 승인 API 를 호출해야 한다.
 *       도네이도는 CONFIRM_LINK 유효시간을 그보다 짧게(기본 300초) 운용한다.
 */

/**
 * 등록할 결제수단 종류.
 * ACCOUNT = 내통장결제 계좌 빌키(현재 운영), CARD = 카드 빌링키(구조만 준비, 실 연동 전).
 */
export type PaymentMethodKind = 'ACCOUNT' | 'CARD';

export interface RegistrationSession {
  /** 결제창 리다이렉트 URL */
  redirectUrl: string;
  providerTid: string;
  expiresAt: Date;
}

export interface RegistrationResult {
  providerTid: string;
  billKey: string;
  /** 발급된 빌키의 종류. 응답에 없으면 ACCOUNT 로 본다. */
  method?: PaymentMethodKind;
  bankCode?: string;
  bankName?: string;
  accountTail4?: string;
  /** 카드 빌링키일 때만 채워진다. 카드번호 원문은 어떤 경우에도 저장하지 않는다. */
  cardIssuer?: string;
  cardTail4?: string;
}

export interface ApproveRequest {
  orderNo: string;
  amount: bigint;
  billKey: string;
  productName: string;
  buyerName?: string;
}

export interface ApproveResult {
  providerTid: string;
  approvedAt: Date;
  amount: bigint;
}

export type InquiryStatus = 'APPROVED' | 'FAILED' | 'CANCELED' | 'NOT_FOUND' | 'PENDING';

export interface PaymentAdapter {
  info(): AdapterInfo;
  createRegistrationSession(input: {
    donorRef: string;
    returnUrl: string;
    notifyUrl: string;
    /** 생략하면 ACCOUNT. 카드 빌링키는 규격 수령 후 어댑터에서 분기한다. */
    method?: PaymentMethodKind;
  }): Promise<ProviderResult<RegistrationSession>>;
  completeRegistration(payload: Record<string, unknown>): Promise<ProviderResult<RegistrationResult>>;
  approve(req: ApproveRequest): Promise<ProviderResult<ApproveResult>>;
  /** 타임아웃/불확실 상태에서 반드시 호출하여 최종 상태를 확정한다. */
  inquire(orderNo: string): Promise<ProviderResult<{ status: InquiryStatus; providerTid?: string; amount?: bigint }>>;
  cancel(input: { orderNo: string; providerTid: string; amount: bigint; reason?: string }): Promise<ProviderResult<{ canceledAt: Date }>>;
  revokeBillKey(billKey: string): Promise<ProviderResult<{ revokedAt: Date }>>;
}

// ---------------------------------------------------------------------------
// Mock 결제 어댑터
// 테스트 시나리오를 재현하기 위해 금액 끝자리로 결과를 제어한다.
//   ...999 → 승인 실패
//   ...888 → 타임아웃 (이후 inquire 로 APPROVED 확정)
//   ...777 → 타임아웃 (이후 inquire 로 FAILED 확정)
//   그 외   → 승인 성공
// ---------------------------------------------------------------------------

const approvedOrders = new Map<string, { tid: string; amount: bigint; at: Date; canceled?: boolean }>();
const timeoutOrders = new Map<string, 'APPROVED' | 'FAILED'>();

export function resetMockPaymentState() {
  approvedOrders.clear();
  timeoutOrders.clear();
}

export class MockPaymentTimeout extends Error {
  constructor(public orderNo: string) {
    super(`결제 요청 타임아웃: ${orderNo}`);
    this.name = 'MockPaymentTimeout';
  }
}

export const mockPaymentAdapter: PaymentAdapter = {
  info() {
    return { provider: 'mock', mode: 'mock', missingCredentials: [] };
  },

  async createRegistrationSession({ donorRef, returnUrl, method = 'ACCOUNT' }) {
    const tid = `MOCKREG${Date.now()}`;
    return {
      ok: true,
      data: {
        // Mock 결제창. 실제 헥토 결제창을 대체하는 내부 화면
        redirectUrl: `/mock/pg/register?tid=${tid}&ref=${encodeURIComponent(donorRef)}&method=${method}&return=${encodeURIComponent(returnUrl)}`,
        providerTid: tid,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    };
  },

  async completeRegistration(payload) {
    const tid = String(payload.tid ?? `MOCKREG${Date.now()}`);
    const method: PaymentMethodKind = payload.method === 'CARD' ? 'CARD' : 'ACCOUNT';

    if (method === 'CARD') {
      const card = String(payload.card ?? '1234567812349876');
      return {
        ok: true,
        data: {
          providerTid: tid,
          method,
          billKey: `MOCKCARDBILL-${tid}-${card.slice(-4)}`,
          cardIssuer: String(payload.cardIssuer ?? '테스트카드'),
          cardTail4: card.slice(-4),
        },
      };
    }

    const bank = String(payload.bankCode ?? '004');
    const account = String(payload.account ?? '11122233344455');
    return {
      ok: true,
      data: {
        providerTid: tid,
        method,
        billKey: `MOCKBILL-${tid}-${account.slice(-4)}`,
        bankCode: bank,
        bankName: String(payload.bankName ?? 'KB국민은행'),
        accountTail4: account.slice(-4),
      },
    };
  },

  async approve(req) {
    const tail = Number(req.amount % 1000n);
    if (tail === 999) {
      return { ok: false, code: 'M0001', message: '잔액 부족 또는 출금 불가 계좌입니다.' };
    }
    if (tail === 888 || tail === 777) {
      timeoutOrders.set(req.orderNo, tail === 888 ? 'APPROVED' : 'FAILED');
      if (tail === 888) {
        // 실제로는 승인되었으나 응답만 유실된 상황을 재현
        approvedOrders.set(req.orderNo, { tid: `MOCKTID-${req.orderNo}`, amount: req.amount, at: new Date() });
      }
      throw new MockPaymentTimeout(req.orderNo);
    }
    if (approvedOrders.has(req.orderNo)) {
      // 동일 주문번호 재요청은 기존 승인 결과를 그대로 반환한다(멱등).
      const prev = approvedOrders.get(req.orderNo)!;
      return { ok: true, data: { providerTid: prev.tid, approvedAt: prev.at, amount: prev.amount } };
    }
    const tid = `MOCKTID-${req.orderNo}`;
    const at = new Date();
    approvedOrders.set(req.orderNo, { tid, amount: req.amount, at });
    return { ok: true, data: { providerTid: tid, approvedAt: at, amount: req.amount }, latencyMs: 30 };
  },

  async inquire(orderNo) {
    const forced = timeoutOrders.get(orderNo);
    if (forced === 'FAILED') return { ok: true, data: { status: 'FAILED' } };
    const rec = approvedOrders.get(orderNo);
    if (!rec) return { ok: true, data: { status: 'NOT_FOUND' } };
    if (rec.canceled) return { ok: true, data: { status: 'CANCELED', providerTid: rec.tid, amount: rec.amount } };
    return { ok: true, data: { status: 'APPROVED', providerTid: rec.tid, amount: rec.amount } };
  },

  async cancel({ orderNo }) {
    const rec = approvedOrders.get(orderNo);
    if (!rec) return { ok: false, code: 'M0404', message: '취소할 거래를 찾을 수 없습니다.' };
    rec.canceled = true;
    return { ok: true, data: { canceledAt: new Date() } };
  },

  async revokeBillKey() {
    return { ok: true, data: { revokedAt: new Date() } };
  },
};

export function getPaymentAdapter(): PaymentAdapter {
  if (env.safety.safeMode && env.payment.provider !== 'mock') {
    logger.warn('SAFE_MODE 가 켜져 있어 실제 결제를 차단하고 mock 으로 대체합니다.');
    return mockPaymentAdapter;
  }
  switch (env.payment.provider) {
    case 'mock':
      return mockPaymentAdapter;
    case 'hecto': {
      // 키가 하나라도 없으면 mock 으로 조용히 대체하지 않고 즉시 실패시킨다.
      // (실결제로 착각한 채 운영되는 상황이 가장 위험하다)
      const adapter = hectoPaymentAdapter;
      const missing = adapter.info().missingCredentials;
      if (missing.length > 0) throw new AdapterNotConfiguredError('hecto', missing);
      return adapter;
    }
    default:
      throw new Error(`PAYMENT_PROVIDER=${env.payment.provider} 어댑터가 구현되지 않았습니다.`);
  }
}
