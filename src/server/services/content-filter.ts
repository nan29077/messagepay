/**
 * 문자 내용 필터.
 *
 * 처리 순서
 *  1) 제어문자/과도한 공백 정리
 *  2) 개인정보 패턴 마스킹 (전화번호, 주민등록번호, 카드/계좌, 이메일, URL)
 *  3) 금칙어 처리 (BLOCK / MASK / FLAG)
 *  4) 길이 제한
 *
 * 방송 노출은 반드시 이 함수의 결과(clean)만 사용한다.
 * 원문은 분쟁 대응을 위해 암호화 보관한다.
 */

export type FilterAction = 'ALLOW' | 'MASK' | 'BLOCK';

export interface BannedWordRule {
  word: string;
  action: 'BLOCK' | 'MASK' | 'FLAG';
}

export interface FilterResult {
  clean: string;
  action: FilterAction;
  reasons: string[];
  flagged: string[];
  containsPersonalInfo: boolean;
}

const RRN = /\b\d{6}[-\s]?[1-4]\d{6}\b/g; // 주민등록번호
const CARD = /\b(?:\d{4}[-\s]?){3}\d{4}\b/g;
const PHONE = /\b01[016789][-\s]?\d{3,4}[-\s]?\d{4}\b/g;
const TEL = /\b0(?:2|[3-6]\d)[-\s]?\d{3,4}[-\s]?\d{4}\b/g;
const ACCOUNT = /\b\d{2,6}[-]\d{2,6}[-]\d{2,6}\b/g;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const URL = /(https?:\/\/|www\.)[^\s]+/gi;
const CONTROL = /[\u0000-\u001F\u007F]/g;
const ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\uFEFF]/g;

function maskRun(match: string): string {
  const visible = match.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(3, match.length - 2))}`;
}

export function normalizeText(input: string): string {
  return (input || '')
    .replace(CONTROL, '')
    .replace(ZERO_WIDTH, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** SHARED_PREFIX 모드에서 문자 맨 앞 키워드를 분리한다. */
export function splitKeyword(text: string): { keyword: string | null; rest: string } {
  const t = normalizeText(text);
  const m = t.match(/^([A-Za-z]{2,10}[-]?\d{2,8}|[A-Za-z0-9]{4,12})\s+(.*)$/);
  if (!m) return { keyword: null, rest: t };
  return { keyword: m[1].toUpperCase().replace(/-/g, ''), rest: m[2] };
}

export function filterContent(
  raw: string,
  options: { bannedWords?: BannedWordRule[]; maxLength?: number } = {},
): FilterResult {
  const reasons: string[] = [];
  const flagged: string[] = [];
  let text = normalizeText(raw);
  let containsPersonalInfo = false;

  const before = text;
  text = text
    .replace(RRN, (m) => {
      containsPersonalInfo = true;
      return maskRun(m);
    })
    .replace(CARD, (m) => {
      containsPersonalInfo = true;
      return maskRun(m);
    })
    .replace(PHONE, (m) => {
      containsPersonalInfo = true;
      return maskRun(m);
    })
    .replace(TEL, (m) => {
      containsPersonalInfo = true;
      return maskRun(m);
    })
    .replace(ACCOUNT, (m) => {
      containsPersonalInfo = true;
      return maskRun(m);
    })
    .replace(EMAIL, (m) => {
      containsPersonalInfo = true;
      return maskRun(m);
    })
    .replace(URL, () => {
      containsPersonalInfo = true;
      return '[링크 차단]';
    });

  if (before !== text) reasons.push('개인정보 또는 링크 마스킹');

  let action: FilterAction = 'ALLOW';

  for (const rule of options.bannedWords ?? []) {
    const word = rule.word.trim();
    if (!word) continue;
    const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    if (!re.test(text)) continue;
    flagged.push(word);
    if (rule.action === 'BLOCK') {
      action = 'BLOCK';
      reasons.push(`금칙어 차단: ${word}`);
    } else if (rule.action === 'MASK') {
      text = text.replace(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => '*'.repeat(m.length));
      if (action === 'ALLOW') action = 'MASK';
      reasons.push(`금칙어 마스킹: ${word}`);
    } else {
      reasons.push(`금칙어 플래그: ${word}`);
    }
  }

  const max = options.maxLength ?? 100;
  if (text.length > max) {
    text = `${text.slice(0, max - 3)}...`;
    reasons.push(`길이 제한 ${max}자 적용`);
  }

  if (!text) {
    text = '(내용 없음)';
  }

  return { clean: text, action, reasons, flagged, containsPersonalInfo };
}
