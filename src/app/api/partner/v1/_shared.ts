import { NextResponse } from 'next/server';
import { prisma } from '@/server/db';
import { newId } from '@/lib/id';
import { logger } from '@/lib/logger';
import { clientIpFromRequest } from '@/server/rate-limit';
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

/**
 * 호출 기록.
 *
 * 연동을 붙이는 동안 무엇이 왜 실패했는지 가맹점이 스스로 봐야 한다.
 * 지금까지는 키의 마지막 사용 시각만 남아 있어서, 401 이 나면 원인을 물어볼 수밖에 없었다.
 *
 * 응답 본문은 남기지 않는다(개인정보). 상태 코드와 오류 코드만 남긴다.
 * 기록 실패가 API 응답을 막지 않도록 예외를 삼킨다.
 */
export async function logPartnerCall(input: {
  req: Request;
  merchantId: string | null;
  keyId?: string | null;
  status: number;
  errorCode?: string | null;
  message?: string | null;
}): Promise<void> {
  if (!input.merchantId) return;
  try {
    const url = new URL(input.req.url);
    await prisma.merchantApiCallLog.create({
      data: {
        id: newId(),
        merchantId: input.merchantId,
        keyId: input.keyId ?? null,
        method: input.req.method.toUpperCase(),
        path: `${url.pathname}${url.search}`.slice(0, 300),
        status: input.status,
        errorCode: input.errorCode ?? null,
        message: input.message?.slice(0, 300) ?? null,
        ip: clientIpFromRequest(input.req),
      },
    });
  } catch (e) {
    logger.warn('연동 API 호출 기록 실패', { message: (e as Error).message });
  }
}
