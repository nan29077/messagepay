import { env } from '@/lib/env';
import { generateToken, maskSecret } from '@/lib/crypto';
import type { AdapterInfo, ProviderResult } from '../types';

/**
 * 자체 방송(RTMPS Ingest) 어댑터.
 * 미디어 서버는 웹 애플리케이션과 분리된 인프라이므로 5단계(4차 개발)에서 실연동한다.
 * MVP 에서는 키 발급/폐기/마스킹 표시만 mock 으로 제공한다.
 */

export interface StreamKeyIssue {
  /** 원문 키. 최초 1회만 노출하고 저장하지 않는다(해시만 저장). */
  key: string;
  keyMasked: string;
  ingestUrl: string;
  playbackUrl: string;
}

export interface StreamAdapter {
  info(): AdapterInfo;
  issueKey(creatorId: string): Promise<ProviderResult<StreamKeyIssue>>;
  revokeKey(keyHash: string): Promise<ProviderResult<{ revokedAt: Date }>>;
  status(creatorId: string): Promise<ProviderResult<{ live: boolean; bitrateKbps?: number; viewers?: number }>>;
}

export const mockStreamAdapter: StreamAdapter = {
  info() {
    return { provider: 'mock', mode: 'mock', missingCredentials: [] };
  },
  async issueKey(creatorId) {
    const key = `tor_${generateToken(18)}`;
    return {
      ok: true,
      data: {
        key,
        keyMasked: maskSecret(key),
        ingestUrl: env.stream.ingestBase,
        playbackUrl: `${env.stream.playbackBase}/${creatorId}.m3u8`,
      },
    };
  },
  async revokeKey() {
    return { ok: true, data: { revokedAt: new Date() } };
  },
  async status() {
    return { ok: true, data: { live: false } };
  },
};

export function getStreamAdapter(): StreamAdapter {
  switch (env.stream.provider) {
    case 'mock':
      return mockStreamAdapter;
    default:
      throw new Error(
        `STREAM_PROVIDER=${env.stream.provider} 어댑터가 구현되지 않았습니다. 미디어 인프라 구축 후 추가하십시오.`,
      );
  }
}
