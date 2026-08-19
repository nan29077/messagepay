/**
 * 환경변수 로더.
 * - 모든 외부 연동 키는 여기서만 읽는다.
 * - 값이 없을 때 임의 기본값으로 "성공 처리"하지 않고, mock 모드로 명시 전환한다.
 */

function str(key: string, fallback = ''): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function bool(key: string, fallback = false): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function num(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) ? v : fallback;
}

export type ProviderMode = 'mock' | string;

export const env = {
  nodeEnv: str('NODE_ENV', 'development'),
  appEnv: str('APP_ENV', 'local'),
  baseUrl: str('APP_BASE_URL', 'http://localhost:3000'),
  timezone: str('APP_TIMEZONE', 'Asia/Seoul'),

  databaseUrl: str('DATABASE_URL'),
  directDatabaseUrl: str('DIRECT_DATABASE_URL'),

  redisUrl: str('REDIS_URL'),
  allowInMemoryFallback: bool('ALLOW_INMEMORY_FALLBACK', true),

  crypto: {
    provider: str('CRYPTO_PROVIDER', 'local') as 'local' | 'aws-kms',
    masterKey: str('CRYPTO_MASTER_KEY'),
    phoneHashSecret: str('PHONE_HASH_SECRET', 'dev-only-phone-hmac-secret'),
    sessionSecret: str('SESSION_SECRET', 'dev-only-session-secret'),
    awsRegion: str('AWS_REGION', 'ap-northeast-2'),
    kmsKeyId: str('AWS_KMS_KEY_ID'),
  },

  payment: {
    provider: str('PAYMENT_PROVIDER', 'mock') as ProviderMode,
    hectoMid: str('HECTO_MID'),
    hectoLicenseKey: str('HECTO_LICENSE_KEY'),
    hectoAesKey: str('HECTO_AES_KEY'),
    hectoHashKey: str('HECTO_HASH_KEY'),
    hectoApiBase: str('HECTO_API_BASE'),
    /** 헥토 공식 제한은 결제인증 후 10분. 그보다 짧게 운용한다. */
    confirmTtlSec: num('PAYMENT_CONFIRM_TTL_SEC', 300),
  },

  mo: {
    provider: str('MO_PROVIDER', 'mock') as ProviderMode,
    webhookSecret: str('MO_WEBHOOK_SECRET'),
    allowedIps: str('MO_ALLOWED_IPS')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  mt: {
    provider: str('MT_PROVIDER', 'mock') as ProviderMode,
    apiKey: str('MT_API_KEY'),
    apiSecret: str('MT_API_SECRET'),
    fromNumber: str('MT_FROM_NUMBER', '15880000'),
  },

  youtube: {
    provider: str('YOUTUBE_PROVIDER', 'mock') as ProviderMode,
    clientId: str('GOOGLE_OAUTH_CLIENT_ID'),
    clientSecret: str('GOOGLE_OAUTH_CLIENT_SECRET'),
    redirectUri: str('GOOGLE_OAUTH_REDIRECT_URI'),
    apiKey: str('YOUTUBE_API_KEY'),
    dailyQuota: num('YOUTUBE_DAILY_QUOTA', 10000),
    insertQuotaCost: num('YOUTUBE_INSERT_QUOTA_COST', 50),
  },

  /** 소셜 간편 로그인 (카카오 / 네이버). 키가 없으면 준비 중 상태로 표시된다. */
  social: {
    kakao: {
      clientId: str('KAKAO_CLIENT_ID'),
      clientSecret: str('KAKAO_CLIENT_SECRET'),
      redirectUri: str('KAKAO_REDIRECT_URI'),
    },
    naver: {
      clientId: str('NAVER_CLIENT_ID'),
      clientSecret: str('NAVER_CLIENT_SECRET'),
      redirectUri: str('NAVER_REDIRECT_URI'),
    },
  },

  tts: {
    provider: str('TTS_PROVIDER', 'mock') as ProviderMode,
    apiKey: str('TTS_API_KEY'),
  },

  stream: {
    provider: str('STREAM_PROVIDER', 'mock') as ProviderMode,
    ingestBase: str('STREAM_INGEST_BASE', 'rtmps://ingest.tornado.kr/live'),
    playbackBase: str('STREAM_PLAYBACK_BASE', 'https://play.tornado.kr/hls'),
  },

  storage: {
    bucket: str('S3_BUCKET'),
    publicBase: str('S3_PUBLIC_BASE'),
  },

  safety: {
    /** 금융사 서면승인 등록 전에는 DIRECT_TRIGGER 를 열지 않는다. */
    allowDirectTrigger: bool('ALLOW_DIRECT_TRIGGER', false),
    /** true 이면 실제 결제/실제 MT 발송을 차단한다. */
    safeMode: bool('SAFE_MODE', true),
  },
} as const;

export const isProd = env.appEnv === 'prod';

/** 운영 배포 전 반드시 통과해야 하는 환경 점검 */
export function assertProductionSafety(): string[] {
  const problems: string[] = [];
  if (!isProd) return problems;
  if (env.crypto.provider !== 'aws-kms') problems.push('운영에서는 CRYPTO_PROVIDER=aws-kms 여야 합니다.');
  if (env.crypto.sessionSecret.startsWith('dev-only')) problems.push('SESSION_SECRET 이 기본값입니다.');
  if (env.crypto.phoneHashSecret.startsWith('dev-only')) problems.push('PHONE_HASH_SECRET 이 기본값입니다.');
  if (env.allowInMemoryFallback) problems.push('운영에서는 ALLOW_INMEMORY_FALLBACK=false 여야 합니다.');
  if (env.mo.allowedIps.length === 0) problems.push('MO_ALLOWED_IPS 가 비어 있습니다.');
  if (env.payment.provider === 'mock') problems.push('PAYMENT_PROVIDER 가 mock 입니다.');
  return problems;
}
