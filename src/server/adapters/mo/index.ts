import { env } from '@/lib/env';
import { verifySignature } from '@/lib/crypto';
import type { AdapterInfo } from '../types';

/** MO 사업자로부터 수신하는 정규화된 인바운드 메시지 */
export interface MoInbound {
  /** 사업자 메시지 ID. 중복 수신 차단의 1차 키 */
  providerMessageId: string;
  providerCode: string;
  /** 수신 MO 번호 */
  receivedNumber: string;
  /** 발신 휴대전화번호 (원문. 즉시 해시/암호화 후 폐기) */
  fromNumber: string;
  messageType: 'SMS' | 'LMS' | 'MMS';
  content: string;
  attachments?: Array<{ name: string; url?: string; size?: number }>;
  receivedAt: Date;
}

export interface MoAdapter {
  info(): AdapterInfo;
  /** Webhook 서명/발신 검증 */
  verify(rawBody: string, headers: Record<string, string>, ip?: string): { ok: boolean; reason?: string };
  /** 사업자별 payload → 정규화 */
  parse(body: unknown): MoInbound;
}

/** 개발/테스트용 Mock MO 사업자 */
export const mockMoAdapter: MoAdapter = {
  info() {
    return { provider: 'mock', mode: 'mock', missingCredentials: [] };
  },

  verify(rawBody, headers, ip) {
    // Mock 은 시크릿이 설정된 경우에만 서명을 검사한다(로컬 편의).
    if (env.mo.allowedIps.length > 0 && ip && !env.mo.allowedIps.includes(ip)) {
      return { ok: false, reason: `허용되지 않은 IP: ${ip}` };
    }
    const sig = headers['x-tornado-signature'] || headers['x-signature'] || '';
    if (!env.mo.webhookSecret) return { ok: true };
    if (!sig) return { ok: false, reason: '서명 헤더 없음' };
    return verifySignature(rawBody, sig, env.mo.webhookSecret)
      ? { ok: true }
      : { ok: false, reason: '서명 불일치' };
  },

  parse(body) {
    const b = body as Record<string, unknown>;
    const required = ['messageId', 'to', 'from', 'text'];
    for (const key of required) {
      if (b[key] === undefined || b[key] === null || b[key] === '') {
        throw new Error(`MO payload 필수값 누락: ${key}`);
      }
    }
    return {
      providerMessageId: String(b.messageId),
      providerCode: 'mock',
      receivedNumber: String(b.to),
      fromNumber: String(b.from),
      messageType: (String(b.type || 'SMS').toUpperCase() as MoInbound['messageType']) || 'SMS',
      content: String(b.text),
      attachments: Array.isArray(b.attachments) ? (b.attachments as MoInbound['attachments']) : undefined,
      receivedAt: b.receivedAt ? new Date(String(b.receivedAt)) : new Date(),
    };
  },
};

export function getMoAdapter(): MoAdapter {
  switch (env.mo.provider) {
    case 'mock':
      return mockMoAdapter;
    default:
      // 실 사업자 어댑터는 계약 확정 후 이 위치에 추가한다.
      // 미구현 사업자를 mock 으로 대체해 "성공 처리"하지 않는다.
      throw new Error(
        `MO_PROVIDER=${env.mo.provider} 어댑터가 구현되지 않았습니다. 사업자 계약 확정 후 추가하십시오.`,
      );
  }
}
