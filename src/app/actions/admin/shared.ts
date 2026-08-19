import { z } from 'zod';
import { requireAdmin, type SessionUser } from '@/server/auth';
import type { AdminActionState } from '@/components/admin/state';

/**
 * 관리자 서버 액션 공통 헬퍼.
 *
 * 규칙
 *  - 모든 액션은 requireAdmin() 을 먼저 통과해야 한다.
 *  - READ_ONLY 권한은 조회만 가능하며 어떤 변경도 수행할 수 없다.
 *  - 변경 성공/실패는 예외를 던지지 않고 AdminActionState 로 돌려준다.
 *
 * 이 파일은 'use server' 가 아니다. (동기 함수/타입을 export 하기 위함)
 */

export type { AdminActionState };

export async function requireWriteAdmin(): Promise<SessionUser> {
  const user = await requireAdmin();
  if (user.adminPermission === 'READ_ONLY') {
    throw new Error('읽기 전용 권한입니다. 변경 작업은 수행할 수 없습니다.');
  }
  return user;
}

/** 액션 본문 실행 래퍼. 성공 시 반환한 문자열이 그대로 사용자 메시지가 된다. */
export async function run(
  fn: (admin: SessionUser) => Promise<string | { message: string; detail?: Record<string, string> }>,
): Promise<AdminActionState> {
  try {
    const admin = await requireWriteAdmin();
    const result = await fn(admin);
    if (typeof result === 'string') return { ok: true, message: result };
    return { ok: true, message: result.message, detail: result.detail };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '처리 중 오류가 발생했습니다.' };
  }
}

// ------------------------------------------------------------------ 입력 파싱

export function text(fd: FormData, key: string): string {
  return String(fd.get(key) ?? '').trim();
}

export function optText(fd: FormData, key: string): string | null {
  const v = text(fd, key);
  return v === '' ? null : v;
}

export function bool(fd: FormData, key: string): boolean {
  const v = text(fd, key);
  return v === 'on' || v === 'true' || v === '1';
}

const intSchema = z.coerce.number().int();

export function int(fd: FormData, key: string, opts?: { min?: number; max?: number; label?: string }): number {
  const raw = text(fd, key).replace(/[,\s]/g, '');
  const parsed = intSchema.safeParse(raw === '' ? NaN : raw);
  if (!parsed.success) throw new Error(`${opts?.label ?? key} 값은 정수로 입력해 주세요.`);
  const n = parsed.data;
  if (opts?.min !== undefined && n < opts.min) throw new Error(`${opts?.label ?? key} 값은 ${opts.min} 이상이어야 합니다.`);
  if (opts?.max !== undefined && n > opts.max) throw new Error(`${opts?.label ?? key} 값은 ${opts.max} 이하여야 합니다.`);
  return n;
}

/** 금액(BigInt). 빈 값은 허용하지 않는다. */
export function money(fd: FormData, key: string, label: string, opts?: { min?: bigint }): bigint {
  const raw = text(fd, key).replace(/[,\s원]/g, '');
  if (!/^\d{1,15}$/.test(raw)) throw new Error(`${label} 금액을 숫자로 입력해 주세요.`);
  const v = BigInt(raw);
  if (opts?.min !== undefined && v < opts.min) throw new Error(`${label} 금액이 너무 작습니다.`);
  return v;
}

/** 금액(BigInt). 빈 값이면 null (= 정책 기본값 사용) */
export function optMoney(fd: FormData, key: string, label: string): bigint | null {
  const raw = text(fd, key).replace(/[,\s원]/g, '');
  if (raw === '') return null;
  if (!/^\d{1,15}$/.test(raw)) throw new Error(`${label} 금액을 숫자로 입력해 주세요.`);
  return BigInt(raw);
}

/** 요율. 0 ~ 1 사이 소수 문자열을 Decimal 컬럼에 그대로 넣는다. */
export function rate(fd: FormData, key: string, label: string): string {
  const raw = text(fd, key);
  if (!/^\d(\.\d{1,6})?$/.test(raw)) throw new Error(`${label} 요율은 0 ~ 1 사이 소수로 입력해 주세요. (예: 0.018)`);
  const n = Number(raw);
  if (!(n >= 0 && n <= 1)) throw new Error(`${label} 요율은 0 ~ 1 사이여야 합니다.`);
  return raw;
}

export function enumValue<T extends string>(fd: FormData, key: string, allowed: readonly T[], label: string): T {
  const v = text(fd, key) as T;
  if (!allowed.includes(v)) throw new Error(`${label} 값이 올바르지 않습니다.`);
  return v;
}

export function requiredId(fd: FormData, key: string, label: string): string {
  const v = text(fd, key);
  if (!v) throw new Error(`${label}을(를) 찾을 수 없습니다.`);
  return v;
}

/** 날짜 입력(YYYY-MM-DD 또는 datetime-local). 빈 값이면 null */
export function optDate(fd: FormData, key: string, label: string): Date | null {
  const raw = text(fd, key);
  if (raw === '') return null;
  const d = new Date(raw.length === 10 ? `${raw}T00:00:00+09:00` : raw);
  if (Number.isNaN(d.getTime())) throw new Error(`${label} 날짜 형식이 올바르지 않습니다.`);
  return d;
}
