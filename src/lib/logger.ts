/**
 * 마스킹 로거.
 * 전화번호/빌키/토큰/계좌번호가 로그로 새어나가지 않도록 출력 직전에 한 번 더 거른다.
 */

const SENSITIVE_KEYS = [
  'phone', 'phoneNumber', 'mobile', 'msisdn',
  'billKey', 'billkey', 'cardNo', 'account', 'accountNo', 'accountNumber',
  'token', 'accessToken', 'refreshToken', 'password',
  'authorization', 'signature', 'secret', 'apiKey', 'licenseKey',
];

const PHONE_RE = /(01[016789])[-\s]?(\d{3,4})[-\s]?(\d{4})/g;

export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value.replace(PHONE_RE, '$1-****-$3');
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s.toLowerCase()))) {
      out[k] = typeof v === 'string' && v.length > 8 ? `${v.slice(0, 2)}***${v.slice(-2)}` : '***';
    } else {
      out[k] = scrub(v, depth + 1);
    }
  }
  return out;
}

type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, message: string, meta?: unknown) {
  const line = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta !== undefined ? { meta: scrub(meta) } : {}),
  };
  const text = JSON.stringify(line);
  if (level === 'error') console.error(text);
  else if (level === 'warn') console.warn(text);
  else console.log(text);
}

export const logger = {
  debug: (m: string, meta?: unknown) => emit('debug', m, meta),
  info: (m: string, meta?: unknown) => emit('info', m, meta),
  warn: (m: string, meta?: unknown) => emit('warn', m, meta),
  error: (m: string, meta?: unknown) => emit('error', m, meta),
};
