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
  PIN_REQUEST: 'PIN_REQUEST',
  DONATION_SUCCESS: 'DONATION_SUCCESS',
  DONATION_FAILED: 'DONATION_FAILED',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
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

/**
 * 최초 1회 결제수단 등록 안내.
 *
 * 계좌(내통장결제)와 카드 빌링키 모두 같은 흐름을 쓴다. 안내 문구만 결제수단에 맞춰 바뀐다.
 * 카드는 아직 실 연동 전이라 현재 호출부는 모두 기본값(ACCOUNT)을 쓴다.
 */
export function tplRegisterGuide(
  creatorName: string,
  link: string,
  method: 'ACCOUNT' | 'CARD' = 'ACCOUNT',
): TemplateOutput {
  const what = method === 'CARD' ? '카드 등록' : '계좌 등록';
  const text = withLink(
    `[도네이도] ${creatorName} 크리에이터 문자후원을 이용하려면 ${what}과 이용 동의가 필요합니다. 최초 문자는 후원 처리되지 않았습니다. 등록:`,
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

/**
 * 결제 PIN 입력 요청.
 *
 * 결제사(헥토/카드)가 발급한 PIN 입력 링크를 후원자에게 보낸다.
 * 이 문자를 받은 시점에는 아직 출금이 일어나지 않았고, PIN 을 입력해야 결제가 완료된다.
 *
 * @param mock 결제사 실연동이 아닌 mock 링크이면 본문에 [MOCK] 을 명시한다.
 *             (계약 전 연동을 실제 결제로 오인하지 않게 하기 위한 표시다)
 */
export function tplPinRequest(input: {
  creatorName: string;
  amount: bigint;
  pinUrl: string;
  ttlMin: number;
  mock: boolean;
}): TemplateOutput {
  const tag = input.mock ? ' [MOCK]' : '';
  const text = withLink(
    `[도네이도]${tag} ${input.creatorName} 크리에이터에게 ${formatNumber(input.amount)}원 후원을 진행합니다. ` +
      `아직 결제되지 않았습니다. 결제 PIN 입력 링크: `,
    `${input.pinUrl} (유효시간: ${input.ttlMin}분)`,
  );
  return { code: MT_TEMPLATE.PIN_REQUEST, text, masked: maskLink(text) };
}

// ---------------------------------------------------------------------------
// 후원 감사 문자 (크리에이터 커스터마이즈)
// ---------------------------------------------------------------------------

export interface DonationSuccessInput {
  donorName: string;
  creatorName: string;
  amount: bigint;
  message: string;
  cumulative: bigint;
  /** 크리에이터가 설정한 감사 문자 본문. 비어 있으면 기본 문구를 쓴다. */
  custom?: string | null;
}

/** 감사 문자 본문 최대 길이. LMS(2,000byte) 안에 확실히 들어가는 보수적인 값. */
export const THANKS_MT_MAX_LENGTH = 200;

/** 감사 문자에서 쓸 수 있는 치환자. 스튜디오 설정 화면 안내와 검증에 함께 쓴다. */
export const THANKS_MT_VARIABLES = [
  { token: '{후원자}', label: '후원자 이름' },
  { token: '{크리에이터}', label: '크리에이터 이름' },
  { token: '{금액}', label: '후원 금액' },
  { token: '{메시지}', label: '후원자가 보낸 메시지' },
  { token: '{누적}', label: '누적 후원 금액' },
] as const;

const THANKS_VALUES: Record<string, (i: DonationSuccessInput) => string> = {
  '후원자': (i) => i.donorName,
  '크리에이터': (i) => i.creatorName,
  '금액': (i) => `${formatNumber(i.amount)}원`,
  '메시지': (i) => i.message,
  '누적': (i) => `${formatNumber(i.cumulative)}원`,
};

const THANKS_TOKEN_RE = /\{(후원자|크리에이터|금액|메시지|누적)\}/g;

/** 문자 본문에 들어가면 안 되는 값(제어문자)을 제거한다. 줄바꿈은 그대로 둔다. */
function sanitizeLine(v: string): string {
  return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
}

/**
 * 크리에이터가 설정한 본문의 치환자를 실제 값으로 바꾼다.
 *
 * 치환값에 `$&` 같은 문자가 들어와도 그대로 남도록 함수형 치환을 쓴다.
 * (문자열 치환을 쓰면 후원자 이름이나 메시지에 `$` 가 있을 때 본문이 깨진다)
 */
export function renderThanksMessage(template: string, input: DonationSuccessInput): string {
  return sanitizeLine(template.replace(THANKS_TOKEN_RE, (_m, key: string) => THANKS_VALUES[key](input)));
}

/** 감사 문자 기본 문구 (크리에이터 설정이 없을 때) */
export function defaultThanksMessage(input: DonationSuccessInput): string {
  return (
    `${input.donorName}님, ${input.creatorName} 크리에이터에게 ${formatNumber(input.amount)}원이 후원되었습니다. 감사합니다. ` +
    `메시지: "${input.message}" 누적 후원: ${formatNumber(input.cumulative)}원`
  );
}

/**
 * 후원 성공 감사 문자.
 *
 * 크리에이터가 스튜디오에서 본문을 설정했으면 그 문구를 쓰고, 없으면 기본 문구를 쓴다.
 * 발신 주체 표기(`[도네이도]`)는 어떤 경우에도 앞에 붙인다.
 */
export function tplDonationSuccess(input: DonationSuccessInput): TemplateOutput {
  const custom = input.custom ? sanitizeLine(input.custom) : '';
  const body = custom ? renderThanksMessage(custom, input) : defaultThanksMessage(input);
  const text = `[도네이도] ${body || defaultThanksMessage(input)}`;
  return { code: MT_TEMPLATE.DONATION_SUCCESS, text, masked: maskLink(text) };
}

export function tplDonationFailed(creatorName: string, reason?: string): TemplateOutput {
  const text =
    `[도네이도] ${creatorName} 크리에이터 후원이 완료되지 않았습니다. ` +
    `${reason ? `사유: ${reason} ` : ''}계좌 상태 또는 이용 한도를 확인해 주세요. 결제되지 않은 메시지는 방송에 표시되지 않습니다.`;
  return { code: MT_TEMPLATE.DONATION_FAILED, text, masked: text };
}

export function tplAccountInactive(creatorName: string): TemplateOutput {
  const text =
    `[도네이도] ${creatorName} 크리에이터 후원을 진행할 수 없습니다. ` +
    '내통장결제 이용 상태를 확인하거나 고객센터로 문의해 주세요. 결제는 진행되지 않았습니다.';
  return { code: MT_TEMPLATE.ACCOUNT_INACTIVE, text, masked: text };
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
