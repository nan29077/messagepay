import { ulid } from 'ulid';

/**
 * ID 는 애플리케이션에서 생성한다(ULID).
 * - 시간순 정렬 가능 → 인덱스 지역성 우수
 * - DB 함수(gen_random_uuid 등)에 의존하지 않아 RDS/Aurora/리플리카 환경에서 안전
 */
export function newId(prefix?: string): string {
  const id = ulid();
  return prefix ? `${prefix}_${id}` : id;
}

/** 대외 노출용 거래번호: TRD-20260819-XXXXXXXX */
export function newTransactionNo(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `TRD-${y}${m}${d}-${ulid().slice(-8)}`;
}

/** PG 가맹점 주문번호. 멱등키로 재사용하므로 거래당 1회만 생성한다. */
export function newOrderNo(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const stamp = kst.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `TOR${stamp}${ulid().slice(-6)}`;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 혼동 문자 제외

/** 크리에이터 코드: TOR-8K2M */
export function newCreatorCode(): string {
  let s = '';
  for (let i = 0; i < 4; i += 1) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `TOR-${s}`;
}

export function normalizeCreatorCode(input: string): string {
  const v = (input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (v.startsWith('TOR')) return `TOR-${v.slice(3)}`;
  return `TOR-${v}`;
}
