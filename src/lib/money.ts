/**
 * 금액 유틸. 모든 금액은 원 단위 정수(BigInt).
 * 부동소수점 연산을 금지하고, 수수료는 정수 반올림 규칙을 명시한다.
 */

export function won(value: bigint | number | string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error('금액은 정수여야 합니다.');
    return BigInt(value);
  }
  return BigInt(value);
}

export function formatWon(value: bigint | number): string {
  const n = typeof value === 'bigint' ? value : BigInt(Math.round(value));
  const neg = n < 0n;
  const s = (neg ? -n : n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${s}원`;
}

export function formatNumber(value: bigint | number): string {
  const n = typeof value === 'bigint' ? value : BigInt(Math.round(value));
  const neg = n < 0n;
  const s = (neg ? -n : n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${s}`;
}

/**
 * 요율 적용. rate 는 문자열 또는 number(예: 0.018).
 * 소수점 이하는 버림(원 단위). 수수료가 결제 금액을 초과하지 않도록 clamp.
 */
export function applyRate(amount: bigint, rate: string | number, fixed: bigint = 0n): bigint {
  const rateStr = typeof rate === 'number' ? rate.toFixed(6) : Number(rate).toFixed(6);
  const micro = BigInt(Math.round(Number(rateStr) * 1_000_000));
  const fee = (amount * micro) / 1_000_000n + fixed;
  if (fee < 0n) return 0n;
  return fee > amount ? amount : fee;
}

/**
 * 소수 요율("0.055")을 화면용 퍼센트 문자열("5.50%")로 바꾼다.
 *
 * 관리자 화면에서 요율은 항상 퍼센트로 보여준다. 소수를 그대로 노출하면
 * 0.055 와 0.55 를 눈으로 구분하기 어렵고, 열 배 차이를 못 알아챈다.
 */
export function ratePercent(value: string | number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return `${(n * 100).toFixed(2)}%`;
}

/** BigInt 를 JSON 으로 직렬화하기 위한 안전 변환 */
export function serializeBigInt<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as T;
}
