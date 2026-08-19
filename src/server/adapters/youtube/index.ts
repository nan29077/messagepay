import { env } from '@/lib/env';
import type { AdapterInfo, ProviderResult } from '../types';

/**
 * 유튜브 어댑터.
 *
 * 원칙
 *  - API Key 만으로 채팅 작성 기능을 구현하지 않는다. 채팅 등록은 OAuth 2.0 권한이 필요하다.
 *  - 필요한 스코프: https://www.googleapis.com/auth/youtube.force-ssl
 *  - 할당량: 기본 일일 10,000 units. liveChatMessages.insert 는 비용이 큰 편이므로
 *    실측 후 증설 신청 전까지 큐 + 상한으로 방어한다.
 *  - 외부 결제이므로 Super Chat 으로 표시하거나 오인시키지 않는다.
 */

export interface YouTubeTokens {
  accessToken: string;
  refreshToken: string;
  scope: string;
  expiresAt: Date;
}

export interface YouTubeChannel {
  channelId: string;
  title: string;
  thumbnailUrl?: string;
}

export interface YouTubeActiveBroadcast {
  broadcastId: string;
  liveChatId: string | null;
  title: string;
  lifeCycleStatus: string;
  chatEnabled: boolean;
  startedAt?: Date;
}

export interface YouTubeAdapter {
  info(): AdapterInfo;
  getAuthUrl(state: string): string;
  exchangeCode(code: string): Promise<ProviderResult<YouTubeTokens>>;
  refresh(refreshToken: string): Promise<ProviderResult<YouTubeTokens>>;
  getChannel(accessToken: string): Promise<ProviderResult<YouTubeChannel>>;
  findActiveBroadcast(accessToken: string): Promise<ProviderResult<YouTubeActiveBroadcast | null>>;
  insertChatMessage(
    accessToken: string,
    liveChatId: string,
    text: string,
  ): Promise<ProviderResult<{ messageId: string; quotaUnits: number }>>;
  revoke(refreshToken: string): Promise<ProviderResult<{ revokedAt: Date }>>;
}

const mockState = {
  live: true,
  broadcastId: 'MOCK-BROADCAST-0001',
  liveChatId: 'MOCK-LIVECHAT-0001',
  messages: [] as Array<{ id: string; text: string; at: Date }>,
};

export function mockYouTubeState() {
  return mockState;
}

export function setMockLive(live: boolean) {
  mockState.live = live;
}

export const mockYouTubeAdapter: YouTubeAdapter = {
  info() {
    return { provider: 'mock', mode: 'mock', missingCredentials: [] };
  },
  getAuthUrl(state) {
    return `/mock/youtube/consent?state=${encodeURIComponent(state)}`;
  },
  async exchangeCode() {
    return {
      ok: true,
      data: {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        scope: 'https://www.googleapis.com/auth/youtube.force-ssl',
        expiresAt: new Date(Date.now() + 3600_000),
      },
    };
  },
  async refresh() {
    return {
      ok: true,
      data: {
        accessToken: `mock-access-token-${Date.now()}`,
        refreshToken: 'mock-refresh-token',
        scope: 'https://www.googleapis.com/auth/youtube.force-ssl',
        expiresAt: new Date(Date.now() + 3600_000),
      },
    };
  },
  async getChannel() {
    return {
      ok: true,
      data: { channelId: 'UCmockchannel0001', title: '토네이도 테스트 채널' },
    };
  },
  async findActiveBroadcast() {
    if (!mockState.live) return { ok: true, data: null };
    return {
      ok: true,
      data: {
        broadcastId: mockState.broadcastId,
        liveChatId: mockState.liveChatId,
        title: '테스트 라이브 방송',
        lifeCycleStatus: 'live',
        chatEnabled: true,
        startedAt: new Date(Date.now() - 600_000),
      },
    };
  },
  async insertChatMessage(_token, _chatId, text) {
    const id = `MOCKMSG-${Date.now()}`;
    mockState.messages.push({ id, text, at: new Date() });
    if (mockState.messages.length > 200) mockState.messages.shift();
    return { ok: true, data: { messageId: id, quotaUnits: env.youtube.insertQuotaCost } };
  },
  async revoke() {
    return { ok: true, data: { revokedAt: new Date() } };
  },
};

export function getYouTubeAdapter(): YouTubeAdapter {
  switch (env.youtube.provider) {
    case 'mock':
      return mockYouTubeAdapter;
    case 'google':
      throw new Error(
        'Google 실연동 어댑터는 OAuth 클라이언트 승인 및 동의화면 검증 완료 후 구현합니다. 현재는 mock 만 사용 가능합니다.',
      );
    default:
      throw new Error(`YOUTUBE_PROVIDER=${env.youtube.provider} 어댑터가 구현되지 않았습니다.`);
  }
}

/**
 * 유튜브 채팅 메시지 포맷.
 * - 이모지를 사용하지 않는다.
 * - Super Chat 으로 오인되지 않도록 "토네이도 후원" 을 명시한다.
 */
export function formatChatMessage(input: {
  donorName: string;
  amount: bigint;
  message: string;
  maxLength?: number;
}): string {
  const amountText = input.amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const head = `[토네이도 후원 ${amountText}원] ${input.donorName}: `;
  const limit = input.maxLength ?? 200;
  const room = Math.max(0, limit - head.length);
  const body = input.message.length > room ? `${input.message.slice(0, Math.max(0, room - 3))}...` : input.message;
  return `${head}${body}`;
}
