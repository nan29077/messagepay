import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import type { AdapterInfo, ProviderResult } from '../types';
// coolsms.ts 는 이 파일에서 타입과 decideMessageType 만 가져온다 (아래에서 정의됨 → 함수 호출 시점에 해석).
import { coolsmsMtAdapter } from './coolsms';

export interface MtSendRequest {
  to: string;
  text: string;
  templateCode?: string;
  /** 90byte 초과 시 자동으로 LMS 로 전환 */
  forceType?: 'SMS' | 'LMS';
}

export interface MtSendResult {
  providerMessageId: string;
  messageType: 'SMS' | 'LMS';
}

export interface MtAdapter {
  info(): AdapterInfo;
  send(req: MtSendRequest): Promise<ProviderResult<MtSendResult>>;
}

export function decideMessageType(text: string, force?: 'SMS' | 'LMS'): 'SMS' | 'LMS' {
  if (force) return force;
  return Buffer.byteLength(text, 'utf8') > 90 ? 'LMS' : 'SMS';
}

/** Mock 발송기. 실제 문자는 나가지 않으며 outbox 에 적재된다. */
const outbox: Array<{ to: string; text: string; at: Date; id: string }> = [];

export function readMockOutbox(limit = 50) {
  return outbox.slice(-limit).reverse();
}

export function clearMockOutbox() {
  outbox.length = 0;
}

export const mockMtAdapter: MtAdapter = {
  info() {
    return { provider: 'mock', mode: 'mock', missingCredentials: [] };
  },
  async send(req) {
    const id = `MTMOCK${Date.now()}${Math.floor(Math.random() * 1000)}`;
    outbox.push({ to: req.to, text: req.text, at: new Date(), id });
    if (outbox.length > 500) outbox.splice(0, outbox.length - 500);
    logger.info('MT(mock) 발송', { to: req.to, template: req.templateCode, bytes: Buffer.byteLength(req.text) });
    return {
      ok: true,
      data: { providerMessageId: id, messageType: decideMessageType(req.text, req.forceType) },
      latencyMs: 5,
    };
  },
};

export function getMtAdapter(): MtAdapter {
  if (env.safety.safeMode && env.mt.provider !== 'mock') {
    logger.warn('SAFE_MODE 가 켜져 있어 실제 MT 발송을 차단하고 mock 으로 대체합니다.');
    return mockMtAdapter;
  }
  switch (env.mt.provider) {
    case 'mock':
      return mockMtAdapter;
    case 'coolsms':
      // 껍데기 어댑터. send() 는 아직 예외를 던진다 (계약 전 성공 처리 금지).
      return coolsmsMtAdapter;
    default:
      throw new Error(
        `MT_PROVIDER=${env.mt.provider} 어댑터가 구현되지 않았습니다. 사업자 계약 확정 후 추가하십시오.`,
      );
  }
}
