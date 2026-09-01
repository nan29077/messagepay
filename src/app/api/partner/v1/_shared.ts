import { NextResponse } from 'next/server';
import type { PartnerAuthFail } from '@/server/services/partner-auth';

/**
 * 가맹점 연동 API 공통 응답 형식.
 *
 * 성공: { ok: true, ...data }
 * 실패: { ok: false, code, message }
 *
 * code 는 기계가 분기할 값이고 message 는 사람이 읽을 값이다.
 * 가맹점 서버가 code 로 분기할 수 있도록 문자열을 바꾸지 않는다.
 */

export function jsonOk(data: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

export function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

export function authError(result: PartnerAuthFail) {
  return jsonError(result.status, result.code, result.message);
}
