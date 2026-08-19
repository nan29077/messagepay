/**
 * 시간 유틸.
 * - DB 저장은 UTC(timestamptz)
 * - 화면 표시/집계 기준일은 Asia/Seoul (KST, UTC+9, 서머타임 없음)
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function toKst(date: Date): Date {
  return new Date(date.getTime() + KST_OFFSET_MS);
}

/** KST 기준 YYYY-MM-DD */
export function kstDateKey(date = new Date()): string {
  const k = toKst(date);
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}-${String(k.getUTCDate()).padStart(2, '0')}`;
}

/** KST 기준 YYYY-MM */
export function kstMonthKey(date = new Date()): string {
  const k = toKst(date);
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** KST 기준 하루의 시작(UTC Date 반환) */
export function kstStartOfDay(date = new Date()): Date {
  const k = toKst(date);
  const startKst = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate(), 0, 0, 0, 0);
  return new Date(startKst - KST_OFFSET_MS);
}

export function kstStartOfMonth(date = new Date()): Date {
  const k = toKst(date);
  const startKst = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 1, 0, 0, 0, 0);
  return new Date(startKst - KST_OFFSET_MS);
}

export function formatKst(date: Date | null | undefined, withSeconds = true): string {
  if (!date) return '-';
  const k = toKst(date);
  const p = (n: number) => String(n).padStart(2, '0');
  const base = `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
  return withSeconds ? `${base}:${p(k.getUTCSeconds())}` : base;
}

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}
