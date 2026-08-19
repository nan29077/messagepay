'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { startRegistration, completeRegistration } from '@/server/services/donor-registration';
import type { ConsentType } from '@/generated/prisma/enums';

/**
 * 후원자 계좌 등록 서버 액션.
 * - 결제창(현재는 Mock)으로 리다이렉트하는 진입점과, 결제창 복귀 처리 두 가지를 제공한다.
 * - 실패 시 임의로 "성공"으로 위장하지 않고 사유를 그대로 화면에 전달한다.
 */

async function requestMeta() {
  const h = await headers();
  return {
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    userAgent: h.get('user-agent') ?? undefined,
  };
}

export interface ConsentPayload {
  type: ConsentType;
  agreed: boolean;
}

export interface ActionError {
  ok: false;
  message: string;
}

/** 동의 저장 → 결제 등록 세션 생성 → 결제창으로 이동 */
export async function startRegistrationAction(
  token: string,
  consents: ConsentPayload[],
): Promise<ActionError | void> {
  const meta = await requestMeta();

  let redirectUrl: string | null = null;
  try {
    const res = await startRegistration({
      token,
      consents,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    redirectUrl = res.redirectUrl;
  } catch (e) {
    return { ok: false, message: (e as Error).message || '계좌 등록을 시작하지 못했습니다.' };
  }

  // redirect() 는 내부적으로 예외를 던지므로 반드시 try 블록 밖에서 호출한다.
  redirect(redirectUrl);
}

export interface CompleteResult {
  ok: boolean;
  message?: string;
  bankName?: string | null;
  accountTail4?: string | null;
}

/** 결제창 복귀 처리. 성공 시 보안링크는 소비되어 다시 사용할 수 없다. */
export async function completeRegistrationAction(input: {
  token: string;
  registrationId: string;
  providerPayload: Record<string, string>;
}): Promise<CompleteResult> {
  const meta = await requestMeta();
  try {
    const res = await completeRegistration({
      token: input.token,
      registrationId: input.registrationId,
      providerPayload: input.providerPayload,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { ok: true, bankName: res.bankName, accountTail4: res.accountTail4 };
  } catch (e) {
    return { ok: false, message: (e as Error).message || '계좌 등록을 완료하지 못했습니다.' };
  }
}
