import { env } from '@/lib/env';
import type { AdapterInfo, ProviderResult } from '../types';

/**
 * TTS 어댑터.
 * MVP 에서는 오버레이 클라이언트의 브라우저 SpeechSynthesis 로 재생하고,
 * 상용 TTS 계약 후 서버 합성(mp3 URL) 방식으로 전환한다.
 */

export interface TtsRequest {
  text: string;
  voice?: string;
  speed?: number;
  volume?: number;
}

export interface TtsResult {
  /** 'browser' 이면 클라이언트가 직접 합성한다 */
  mode: 'browser' | 'audio';
  audioUrl?: string;
  voice: string;
  speed: number;
  volume: number;
}

export interface TtsAdapter {
  info(): AdapterInfo;
  synthesize(req: TtsRequest): Promise<ProviderResult<TtsResult>>;
}

export const mockTtsAdapter: TtsAdapter = {
  info() {
    return { provider: 'mock', mode: 'mock', missingCredentials: [] };
  },
  async synthesize(req) {
    return {
      ok: true,
      data: {
        mode: 'browser',
        voice: req.voice ?? 'ko-KR-Standard-A',
        speed: req.speed ?? 1,
        volume: req.volume ?? 1,
      },
    };
  },
};

export function getTtsAdapter(): TtsAdapter {
  switch (env.tts.provider) {
    case 'mock':
    case 'browser':
      return mockTtsAdapter;
    default:
      throw new Error(`TTS_PROVIDER=${env.tts.provider} 어댑터가 구현되지 않았습니다.`);
  }
}

/** TTS 로 읽을 문장 생성. 이모지/특수문자는 제거한다. */
export function buildTtsText(input: {
  donorName: string;
  amount: bigint;
  message: string;
  readAmount: boolean;
  readName: boolean;
  maxChars: number;
}): string {
  const parts: string[] = [];
  if (input.readName) parts.push(`${input.donorName}님`);
  if (input.readAmount) {
    const amountText = input.amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    parts.push(`${amountText}원 후원`);
  }
  const head = parts.join(' ');
  const body = input.message.slice(0, input.maxChars);
  return `${head}${head ? '. ' : ''}${body}`
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
