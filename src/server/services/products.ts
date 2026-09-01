import { prisma } from '@/server/db';
import type { ChargeProduct, MerchantShippingPolicy } from '@/generated/prisma/client';
import type { DigitalProductType, ProductKind } from '@/generated/prisma/enums';

/**
 * 상품과 배송비.
 *
 * 상품은 두 종류다.
 *  - 비실물(DIGITAL) : 포인트 · 상품권 · 이용권. 배송이 없고 재고도 세지 않는다.
 *  - 실물(PHYSICAL)  : 배송비 · 조건부 무료 · 재고 · 옵션을 관리한다.
 *
 * **배송비 계산은 반드시 이 파일의 함수 하나만 쓴다.**
 * 화면에서 보여준 금액과 서버가 실제로 청구한 금액이 다르면 그대로 결제 분쟁이 된다.
 * 그래서 상품 선택 화면·확정 로직·주문 조회가 모두 같은 함수를 부른다.
 */

/** 배송정책이 없을 때 쓰는 기본값. 화면과 계산이 같은 값을 보게 한 곳에 둔다. */
export const DEFAULT_SHIPPING = {
  baseFee: 3000n,
  freeOver: null as bigint | null,
  remoteFee: 0n,
} as const;

export interface ShippingPolicyView {
  baseFee: bigint;
  freeOver: bigint | null;
  remoteFee: bigint;
  carrier: string | null;
  guide: string | null;
}

export function shippingPolicyOf(row: MerchantShippingPolicy | null): ShippingPolicyView {
  return {
    baseFee: row?.baseFee ?? DEFAULT_SHIPPING.baseFee,
    freeOver: row?.freeOver ?? DEFAULT_SHIPPING.freeOver,
    remoteFee: row?.remoteFee ?? DEFAULT_SHIPPING.remoteFee,
    carrier: row?.carrier ?? null,
    guide: row?.guide ?? null,
  };
}

export async function loadShippingPolicy(merchantId: string): Promise<ShippingPolicyView> {
  const row = await prisma.merchantShippingPolicy.findUnique({ where: { merchantId } });
  return shippingPolicyOf(row);
}

/** 배송비 계산에 필요한 상품 값만 추린 것 (Prisma 행을 그대로 넘겨도 된다) */
export interface ShippingProductInput {
  kind: ProductKind;
  amount: bigint;
  shippingFee: bigint | null;
  freeShipOver: bigint | null;
  freeShipping: boolean;
}

export interface ShippingQuote {
  /** 상품 가격 합계 (배송비 제외) */
  goods: bigint;
  /** 청구할 배송비 */
  fee: bigint;
  /** 도서산간 추가분 (fee 에 이미 포함되어 있다. 표시용) */
  remoteExtra: bigint;
  /** 총 결제 금액 = goods + fee */
  total: bigint;
  /** 무료배송이 적용된 이유 (없으면 null) */
  freeReason: '무료배송 상품' | '조건부 무료' | null;
  /** 얼마를 더 담으면 무료가 되는지 (조건부 무료가 있고 아직 못 미쳤을 때만) */
  freeShortfall: bigint | null;
}

/**
 * 실물 상품 1종 주문의 배송비를 계산한다.
 *
 * 우선순위
 *  1. 상품이 '항상 무료배송' 이면 0원.
 *  2. 조건부 무료 기준(상품값 → 없으면 가맹점 정책)을 상품가 합계가 넘으면 0원.
 *  3. 그 외에는 상품 배송비(없으면 가맹점 기본 배송비).
 *  4. 도서산간이면 위 결과에 추가 배송비를 더한다.
 *     (무료배송이어도 도서산간 추가분은 붙는다 — 실제 택배 요금 구조와 같다)
 */
export function quoteShipping(
  product: ShippingProductInput,
  quantity: number,
  policy: ShippingPolicyView,
  remote = false,
): ShippingQuote {
  const goods = product.amount * BigInt(Math.max(1, quantity));

  // 비실물은 배송 자체가 없다.
  if (product.kind !== 'PHYSICAL') {
    return { goods, fee: 0n, remoteExtra: 0n, total: goods, freeReason: null, freeShortfall: null };
  }

  const remoteExtra = remote ? policy.remoteFee : 0n;
  const freeOver = product.freeShipOver ?? policy.freeOver;

  if (product.freeShipping) {
    return {
      goods,
      fee: remoteExtra,
      remoteExtra,
      total: goods + remoteExtra,
      freeReason: '무료배송 상품',
      freeShortfall: null,
    };
  }

  if (freeOver !== null && goods >= freeOver) {
    return {
      goods,
      fee: remoteExtra,
      remoteExtra,
      total: goods + remoteExtra,
      freeReason: '조건부 무료',
      freeShortfall: null,
    };
  }

  const base = product.shippingFee ?? policy.baseFee;
  return {
    goods,
    fee: base + remoteExtra,
    remoteExtra,
    total: goods + base + remoteExtra,
    freeReason: null,
    freeShortfall: freeOver !== null ? freeOver - goods : null,
  };
}

// ---------------------------------------------------------------------------
// 옵션
// ---------------------------------------------------------------------------

export interface ProductOption {
  name: string;
  values: string[];
}

/**
 * 상품 옵션 JSON 을 안전하게 읽는다.
 *
 * DB 의 Json 컬럼은 어떤 모양이든 들어올 수 있으므로(과거 데이터·수기 수정),
 * 모양이 맞지 않으면 예외를 던지지 말고 빈 배열로 떨어뜨린다.
 * 여기서 throw 하면 상품 하나 때문에 결제 화면 전체가 뜨지 않는다.
 */
export function parseOptions(raw: unknown): ProductOption[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const name = String((item as { name?: unknown }).name ?? '').trim();
    const values = (item as { values?: unknown }).values;
    if (!name || !Array.isArray(values)) continue;
    const list = values.map((v) => String(v).trim()).filter(Boolean).slice(0, 30);
    if (list.length === 0) continue;
    out.push({ name: name.slice(0, 20), values: list });
    if (out.length >= 3) break; // 옵션은 최대 3종까지만 다룬다
  }
  return out;
}

/**
 * "사이즈:S,M,L" 형태의 입력 여러 줄을 옵션 정의로 바꾼다.
 * 가맹점이 표를 만들지 않고도 옵션을 넣을 수 있게 하는 입력 형식이다.
 */
export function parseOptionLines(text: string): ProductOption[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 3);
  const out: ProductOption[] = [];
  for (const line of lines) {
    const [rawName, rawValues] = line.split(':');
    const name = (rawName ?? '').trim();
    const values = (rawValues ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, 30);
    if (!name || values.length === 0) continue;
    out.push({ name: name.slice(0, 20), values });
  }
  return out;
}

/** 옵션 정의를 편집 화면의 여러 줄 텍스트로 되돌린다. */
export function optionsToLines(raw: unknown): string {
  return parseOptions(raw)
    .map((o) => `${o.name}: ${o.values.join(', ')}`)
    .join('\n');
}

/**
 * 이용자가 고른 옵션이 상품 정의에 있는 값인지 확인하고, 표기 문자열로 만든다.
 * 정의에 없는 값이 들어오면(폼 조작) 거절한다.
 */
export function buildOptionText(
  raw: unknown,
  selected: Record<string, string>,
): { ok: true; text: string | null } | { ok: false; message: string } {
  const defs = parseOptions(raw);
  if (defs.length === 0) return { ok: true, text: null };

  const parts: string[] = [];
  for (const def of defs) {
    const picked = (selected[def.name] ?? '').trim();
    if (!picked) return { ok: false, message: `${def.name} 을(를) 선택해 주세요.` };
    if (!def.values.includes(picked)) return { ok: false, message: `${def.name} 선택값이 올바르지 않습니다.` };
    parts.push(`${def.name}: ${picked}`);
  }
  return { ok: true, text: parts.join(' / ') };
}

// ---------------------------------------------------------------------------
// 표기
// ---------------------------------------------------------------------------

export const productKindLabel: Record<ProductKind, string> = {
  DIGITAL: '비실물',
  PHYSICAL: '실물',
};

export const digitalTypeLabel: Record<DigitalProductType, string> = {
  POINT: '포인트',
  VOUCHER: '상품권',
  PASS: '이용권',
};

/** 지급 수량 안내 문구. 포인트는 금액과 1:1 이 기본이다. */
export function giveText(p: Pick<ChargeProduct, 'kind' | 'digitalType' | 'amount' | 'giveAmount' | 'giveUnit' | 'validDays'>): string | null {
  if (p.kind !== 'DIGITAL') return null;
  const unit = p.giveUnit?.trim() || (p.digitalType === 'POINT' ? '포인트' : p.digitalType === 'VOUCHER' ? '매' : '개월');
  const value = p.giveAmount ?? (p.digitalType === 'POINT' ? p.amount : null);
  if (value === null) return null;
  const base = `${value.toLocaleString('ko-KR')}${unit}`;
  return p.validDays ? `${base} (유효기간 ${p.validDays}일)` : base;
}

/** 재고 표기. null 이면 무제한이라 문구를 만들지 않는다. */
export function stockText(p: Pick<ChargeProduct, 'kind' | 'stock'>): string | null {
  if (p.kind !== 'PHYSICAL' || p.stock === null) return null;
  return p.stock <= 0 ? '품절' : `재고 ${p.stock.toLocaleString('ko-KR')}개`;
}
