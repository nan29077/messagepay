import { formatNumber } from '@/lib/money';

/**
 * MT 문자 템플릿.
 * - 이모지를 사용하지 않는다.
 * - 최초 문자가 후원 처리되지 않았음을 명확히 고지한다.
 * - 보안 링크 원문은 로그/DB 본문에 남기지 않고 마스킹해 저장한다.
 */

export const MT_TEMPLATE = {
  REGISTER_GUIDE: 'REGISTER_GUIDE',
  CONFIRM_PAYMENT: 'CONFIRM_PAYMENT',
  DONATION_SUCCESS: 'DONATION_SUCCESS',
  DONATION_FAILED: 'DONATION_FAILED',
  LIMIT_BLOCKED: 'LIMIT_BLOCKED',
  CONTENT_BLOCKED: 'CONTENT_BLOCKED',
  REFUND_DONE: 'REFUND_DONE',
  UNKNOWN_ROUTE: 'UNKNOWN_ROUTE',
} as const;

export type MtTemplateCode = (typeof MT_TEMPLATE)[keyof typeof MT_TEMPLATE];

export interface TemplateOutput {
  code: MtTemplateCode;
  text: string;
  /** DB/로그 저장용. 링크 토큰을 제거한 본문 */
  masked: string;
}

function withLink(body: string, link: string): TemplateOutput['text'] {
  return `${body} ${link}`;
}

function maskLink(text: string): string {
  return text.replace(/https?:\/\/[^\s]+/g, '[보안링크]');
}

export function tplRegisterGuide(creatorName: string, link: string): TemplateOutput {
  const text = withLink(
    `[도네이도] ${creatorName} 크리에이터 문자후원을 이용하려면 계좌 등록과 이용 동의가 필요합니다. 최초 문자는 후원 처리되지 않았습니다. 등록:`,
    link,
  );
  return { code: MT_TEMPLATE.REGISTER_GUIDE, text, masked: maskLink(text) };
}

export function tplConfirmPayment(creatorName: string, amount: bigint, link: string, ttlMin: number): TemplateOutput {
  const text = withLink(
    `[도네이도] ${creatorName} 크리에이터에게 ${formatNumber(amount)}원을 후원하시려면 아래 링크에서 확인해 주세요. ${ttlMin}분 내 미확인 시 자동 취소됩니다. 확인:`,
    link,
  );
  return { code: MT_TEMPLATE.CONFIRM_PAYMENT, text, masked: maskLink(text) };
}

export function tplDonationSuccess(input: {
  creatorName: string;
  amount: bigint;
  message: string;
  cumulative: bigint;
}): TemplateOutput {
  const text =
    `[도네이도] ${input.creatorName} 크리에이터에게 ${formatNumber(input.amount)}원이 후원되었습니다. ` +
    `메시지: "${input.message}" 누적 후원: ${formatNumber(input.cumulative)}원`;
  return { code: MT_TEMPLATE.DONATION_SUCCESS, text, masked: text };
}

export function tplDonationFailed(creatorName: string, reason?: string): TemplateOutput {
  const text =
    `[도네이도] ${creatorName} 크리에이터 후원이 완료되지 않았습니다. ` +
    `${reason ? `사유: ${reason} ` : ''}계좌 상태 또는 이용 한도를 확인해 주세요. 결제되지 않은 메시지는 방송에 표시되지 않습니다.`;
  return { code: MT_TEMPLATE.DONATION_FAILED, text, masked: text };
}

export function tplLimitBlocked(creatorName: string, reason: string): TemplateOutput {
  const text = `[도네이도] ${creatorName} 크리에이터 후원이 제한되었습니다. 사유: ${reason} 결제는 진행되지 않았습니다.`;
  return { code: MT_TEMPLATE.LIMIT_BLOCKED, text, masked: text };
}

export function tplContentBlocked(creatorName: string): TemplateOutput {
  const text = `[도네이도] ${creatorName} 크리에이터에게 보낸 메시지가 운영정책에 따라 차단되었습니다. 결제는 진행되지 않았습니다.`;
  return { code: MT_TEMPLATE.CONTENT_BLOCKED, text, masked: text };
}

export function tplRefundDone(creatorName: string, amount: bigint): TemplateOutput {
  const text = `[도네이도] ${creatorName} 크리에이터 후원 ${formatNumber(amount)}원이 취소되어 환불 처리되었습니다.`;
  return { code: MT_TEMPLATE.REFUND_DONE, text, masked: text };
}

export function tplUnknownRoute(): TemplateOutput {
  const text =
    '[도네이도] 후원 대상 크리에이터를 찾을 수 없습니다. 방송 화면에 안내된 번호와 코드를 다시 확인해 주세요. 결제는 진행되지 않았습니다.';
  return { code: MT_TEMPLATE.UNKNOWN_ROUTE, text, masked: text };
}
