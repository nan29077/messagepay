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

/**
 * TTS 로 읽기 좋은 금액 표기.
 *  3000 → "3천", 15000 → "1만 5천", 1000000 → "100만", 1234 → "1천 2백 34"
 * 숫자 그대로("3,000") 읽히는 것보다 자연스럽게 들린다.
 */
export function speakableAmount(amount: bigint): string {
  let n = amount < 0n ? -amount : amount;
  if (n === 0n) return '0';

  const parts: string[] = [];
  const eok = n / 100_000_000n;
  if (eok > 0n) {
    parts.push(`${eok}억`);
    n %= 100_000_000n;
  }
  const man = n / 10_000n;
  if (man > 0n) {
    parts.push(`${man}만`);
    n %= 10_000n;
  }
  const chun = n / 1_000n;
  if (chun > 0n) {
    parts.push(`${chun}천`);
    n %= 1_000n;
  }
  const baek = n / 100n;
  if (baek > 0n) {
    parts.push(`${baek}백`);
    n %= 100n;
  }
  if (n > 0n) parts.push(n.toString());
  return parts.join(' ');
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
    parts.push(`${speakableAmount(input.amount)}원 후원`);
  }
  const head = parts.join(' ');
  const body = input.message.slice(0, input.maxChars);
  return `${head}${head ? '. ' : ''}${body}`
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
