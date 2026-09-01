'use client';

import * as React from 'react';
import { Pencil, Package, Truck } from 'lucide-react';
import { cx } from '@/components/ui';
import { formatWon } from '@/lib/money';
import { confirmChargeAmountAction, type SelectAmountState } from '@/app/actions/charge-select';

/**
 * 상품·금액 선택 화면.
 *
 * 상품을 고르거나 직접 입력한 뒤 버튼을 누르면 그 자리에서 결제사 PIN 입력 화면으로 넘어간다.
 * 문자를 한 번 더 보내지 않는다.
 *
 * 실물 상품은 수량·옵션·배송지를 함께 받는다.
 * **여기서 보여주는 금액은 서버가 같은 규칙으로 다시 계산해 확정한다.**
 * (화면 값을 그대로 믿으면 폼을 고쳐 배송비를 0원으로 만들 수 있다)
 */

const initial: SelectAmountState = { ok: false };

export interface PanelProduct {
  id: string;
  kind: 'DIGITAL' | 'PHYSICAL';
  digitalType: 'POINT' | 'VOUCHER' | 'PASS' | null;
  name: string;
  amount: string;
  description: string | null;
  give: string | null;
  stock: number | null;
  soldOut: boolean;
  maxPerOrder: number | null;
  options: Array<{ name: string; values: string[] }>;
  shippingFee: string;
  freeReason: string | null;
  freeShortfall: string | null;
  payable: boolean;
}

const KIND_BADGE: Record<string, string> = {
  POINT: '포인트',
  VOUCHER: '상품권',
  PASS: '이용권',
};

export function SelectAmountPanel({
  token,
  merchantName,
  products,
  allowCustom,
  minAmount,
  maxAmount,
  message,
  paymentMock,
  shippingGuide,
  carrier,
  remoteFee,
}: {
  token: string;
  merchantName: string;
  products: PanelProduct[];
  allowCustom: boolean;
  minAmount: string;
  maxAmount: string;
  message: string;
  paymentMock: boolean;
  shippingGuide: string | null;
  carrier: string | null;
  remoteFee: string;
}) {
  const min = BigInt(minAmount);
  const max = BigInt(maxAmount);

  const [state, formAction, pending] = React.useActionState(confirmChargeAmountAction, initial);

  const firstSelectable = products.find((p) => p.payable && !p.soldOut) ?? products[0];
  const [productId, setProductId] = React.useState<string>(firstSelectable?.id ?? '');
  const [custom, setCustom] = React.useState('');
  const [mode, setMode] = React.useState<'preset' | 'custom'>(
    products.length > 0 ? 'preset' : 'custom',
  );
  const [qty, setQty] = React.useState(1);
  const [opts, setOpts] = React.useState<Record<string, string>>({});
  const [addr, setAddr] = React.useState({
    receiver: '',
    phone: '',
    zipCode: '',
    address1: '',
    address2: '',
    memo: '',
  });

  // 결제사 PIN 화면으로 이동. 성공 응답에 담긴 주소는 1회용이다.
  React.useEffect(() => {
    if (state.ok && state.pinUrl) window.location.href = state.pinUrl;
  }, [state.ok, state.pinUrl]);

  const selected = products.find((p) => p.id === productId) ?? null;
  const isPhysical = mode === 'preset' && selected?.kind === 'PHYSICAL';

  // 상품이 바뀌면 수량·옵션을 초기화한다. 이전 상품의 옵션이 남으면 서버 검증에서 막힌다.
  React.useEffect(() => {
    setQty(1);
    setOpts({});
  }, [productId]);

  const customAmount = React.useMemo(() => {
    const digits = custom.replace(/[^\d]/g, '');
    if (!digits) return null;
    try {
      return BigInt(digits);
    } catch {
      return null;
    }
  }, [custom]);

  const maxQty = React.useMemo(() => {
    if (!selected || selected.kind !== 'PHYSICAL') return 1;
    const limits = [selected.maxPerOrder ?? 99, selected.stock ?? 99, 99];
    return Math.max(1, Math.min(...limits));
  }, [selected]);

  /** 화면에 보여줄 금액. 서버가 같은 규칙으로 다시 계산한다. */
  const preview = React.useMemo(() => {
    if (mode === 'custom') return { goods: customAmount, fee: 0n, total: customAmount };
    if (!selected) return { goods: null, fee: 0n, total: null };
    const goods = BigInt(selected.amount) * BigInt(qty);
    if (selected.kind !== 'PHYSICAL') return { goods, fee: 0n, total: goods };
    // 수량이 늘면 조건부 무료 기준을 넘을 수 있다. 1개 기준 배송비에서 다시 판단한다.
    const shortfall = selected.freeShortfall !== null ? BigInt(selected.freeShortfall) : null;
    const oneGoods = BigInt(selected.amount);
    const free = selected.freeReason !== null || (shortfall !== null && goods >= oneGoods + shortfall);
    const fee = free ? 0n : BigInt(selected.shippingFee);
    return { goods, fee, total: goods + fee };
  }, [mode, selected, qty, customAmount]);

  const optionsFilled =
    !isPhysical || (selected?.options ?? []).every((o) => (opts[o.name] ?? '').length > 0);
  const addressFilled =
    !isPhysical ||
    (addr.receiver.trim().length >= 2 &&
      /^01[016789]\d{7,8}$/.test(addr.phone.replace(/[^\d]/g, '')) &&
      addr.zipCode.replace(/[^\d]/g, '').length === 5 &&
      addr.address1.trim().length >= 5);

  const amountValid =
    preview.total !== null && preview.total >= min && preview.total <= max;
  const valid =
    amountValid &&
    optionsFilled &&
    addressFilled &&
    (mode === 'custom' || (selected !== null && selected.payable && !selected.soldOut));

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[13px] font-bold text-ink-900">상품 선택</p>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-500">
          {merchantName} 에서 구매할 상품을 골라 주세요.
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {products.map((p) => {
            const active = mode === 'preset' && productId === p.id;
            const disabled = p.soldOut || !p.payable;
            return (
              <button
                key={p.id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setMode('preset');
                  setProductId(p.id);
                }}
                className={cx(
                  'min-h-16 rounded-2xl px-3.5 py-2.5 text-left transition-colors',
                  disabled
                    ? 'cursor-not-allowed bg-ink-50 text-ink-300'
                    : active
                      ? 'bg-ink-900 text-brand-400'
                      : 'bg-ink-50 text-ink-800 hover:bg-ink-100',
                )}
              >
                <span className="flex items-center gap-1.5">
                  {p.kind === 'PHYSICAL' ? (
                    <Package size={13} strokeWidth={2} className="shrink-0 opacity-70" />
                  ) : null}
                  <span className="block text-[13.5px] font-bold leading-tight">{p.name}</span>
                </span>
                <span className="mt-0.5 block text-[12px] font-semibold opacity-80">
                  {formatWon(BigInt(p.amount))}
                  {p.kind === 'PHYSICAL' ? (
                    <span className="ml-1 opacity-70">
                      {p.freeReason ? '· 배송비 무료' : `· 배송비 ${formatWon(BigInt(p.shippingFee))}`}
                    </span>
                  ) : p.digitalType ? (
                    <span className="ml-1 opacity-70">· {KIND_BADGE[p.digitalType]}</span>
                  ) : null}
                </span>
                {p.soldOut ? (
                  <span className="mt-0.5 block text-[11px] font-bold text-danger-500">품절</span>
                ) : !p.payable ? (
                  <span className="mt-0.5 block text-[11px] font-bold text-danger-500">결제 한도 초과</span>
                ) : p.give ? (
                  <span className="mt-0.5 block text-[11px] opacity-70">{p.give} 지급</span>
                ) : p.stock !== null && p.stock <= 5 ? (
                  <span className="mt-0.5 block text-[11px] font-bold opacity-80">{p.stock}개 남음</span>
                ) : null}
              </button>
            );
          })}

          {allowCustom ? (
            <button
              type="button"
              onClick={() => setMode('custom')}
              className={cx(
                'flex min-h-16 items-center justify-center gap-1.5 rounded-2xl px-3.5 text-[13.5px] font-bold transition-colors',
                mode === 'custom' ? 'bg-ink-900 text-brand-400' : 'bg-ink-50 text-ink-700 hover:bg-ink-100',
              )}
            >
              <Pencil size={14} strokeWidth={1.9} />
              직접 입력
            </button>
          ) : null}
        </div>

        {mode === 'preset' && selected?.description ? (
          <p className="mt-2 rounded-xl bg-ink-50 px-3.5 py-2 text-[12px] leading-relaxed text-ink-600">
            {selected.description}
          </p>
        ) : null}

        {mode === 'custom' ? (
          <div className="mt-3">
            <div className="flex items-center gap-2">
              <input
                inputMode="numeric"
                value={custom}
                onChange={(e) => setCustom(e.target.value.replace(/[^\d]/g, ''))}
                placeholder={`${min.toString()} ~ ${max.toString()}`}
                aria-label="직접 입력 결제 금액"
                className="h-12 w-44 rounded-xl border border-ink-200 px-3.5 text-right text-[15px] font-bold tabular-nums outline-none focus:border-brand-400"
              />
              <span className="text-[14px] font-bold text-ink-700">원</span>
            </div>
            {!amountValid && custom ? (
              <p className="mt-1.5 text-[12px] font-semibold text-danger-500">
                {formatWon(min)} ~ {formatWon(max)} 사이로 입력해 주세요.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ── 실물 상품: 수량 · 옵션 · 배송지 ───────────────────────── */}
      {isPhysical && selected ? (
        <div className="space-y-3 rounded-2xl border border-ink-100 p-3.5">
          <div className="flex items-center gap-1.5">
            <Truck size={15} strokeWidth={1.9} className="text-brand-700" />
            <p className="text-[13px] font-bold text-ink-900">주문 정보</p>
          </div>

          <div>
            <label className="text-[12px] font-semibold text-ink-600" htmlFor="qty">
              수량
            </label>
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="h-10 w-10 rounded-xl bg-ink-50 text-[16px] font-bold text-ink-700 hover:bg-ink-100"
                aria-label="수량 줄이기"
              >
                −
              </button>
              <input
                id="qty"
                inputMode="numeric"
                value={qty}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value.replace(/[^\d]/g, ''), 10);
                  setQty(Number.isFinite(n) ? Math.max(1, Math.min(maxQty, n)) : 1);
                }}
                className="h-10 w-16 rounded-xl border border-ink-200 text-center text-[15px] font-bold tabular-nums outline-none focus:border-brand-400"
              />
              <button
                type="button"
                onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                className="h-10 w-10 rounded-xl bg-ink-50 text-[16px] font-bold text-ink-700 hover:bg-ink-100"
                aria-label="수량 늘리기"
              >
                +
              </button>
              <span className="text-[11.5px] text-ink-400">
                최대 {maxQty}개
                {selected.stock !== null ? ` · 재고 ${selected.stock}개` : ''}
              </span>
            </div>
          </div>

          {selected.options.map((o) => (
            <div key={o.name}>
              <label className="text-[12px] font-semibold text-ink-600" htmlFor={`opt-${o.name}`}>
                {o.name}
              </label>
              <select
                id={`opt-${o.name}`}
                value={opts[o.name] ?? ''}
                onChange={(e) => setOpts((prev) => ({ ...prev, [o.name]: e.target.value }))}
                className="mt-1 h-11 w-full rounded-xl border border-ink-200 px-3 text-[14px] outline-none focus:border-brand-400"
              >
                <option value="">선택해 주세요</option>
                {o.values.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          ))}

          <div className="grid gap-2 sm:grid-cols-2">
            <Text label="받는 분" value={addr.receiver} onChange={(v) => setAddr((a) => ({ ...a, receiver: v }))} placeholder="홍길동" maxLength={30} />
            <Text
              label="연락처"
              value={addr.phone}
              onChange={(v) => setAddr((a) => ({ ...a, phone: v.replace(/[^\d-]/g, '') }))}
              placeholder="01012345678"
              maxLength={13}
              inputMode="numeric"
            />
            <Text
              label="우편번호"
              value={addr.zipCode}
              onChange={(v) => setAddr((a) => ({ ...a, zipCode: v.replace(/[^\d]/g, '') }))}
              placeholder="06236"
              maxLength={5}
              inputMode="numeric"
            />
            <Text label="상세주소" value={addr.address2} onChange={(v) => setAddr((a) => ({ ...a, address2: v }))} placeholder="101동 1001호" maxLength={60} />
          </div>
          <Text label="주소" value={addr.address1} onChange={(v) => setAddr((a) => ({ ...a, address1: v }))} placeholder="서울특별시 강남구 테헤란로 1" maxLength={120} />
          <Text label="배송 메모 (선택)" value={addr.memo} onChange={(v) => setAddr((a) => ({ ...a, memo: v }))} placeholder="부재 시 경비실에 맡겨 주세요" maxLength={100} />

          <div className="rounded-xl bg-ink-50 px-3.5 py-2.5">
            <Row label={`상품 ${qty}개`} value={formatWon(preview.goods ?? 0n)} />
            <Row
              label="배송비"
              value={preview.fee === 0n ? '무료' : formatWon(preview.fee)}
            />
            <div className="mt-1.5 flex items-center justify-between border-t border-ink-200 pt-1.5">
              <span className="text-[13px] font-bold text-ink-900">결제 금액</span>
              <span className="text-[15px] font-extrabold tabular-nums text-ink-900">
                {formatWon(preview.total ?? 0n)}
              </span>
            </div>
            {BigInt(remoteFee) > 0n ? (
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-400">
                제주·도서산간은 {formatWon(BigInt(remoteFee))} 이 추가됩니다. 우편번호로 자동 판단되며, 최종 금액은
                다음 화면에서 다시 안내됩니다.
              </p>
            ) : null}
          </div>

          {shippingGuide || carrier ? (
            <p className="text-[11.5px] leading-relaxed text-ink-400">
              {carrier ? `${carrier} · ` : ''}
              {shippingGuide ?? '발송 일정은 가맹점 안내를 따릅니다.'}
            </p>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <div className="rounded-xl bg-ink-50 px-3.5 py-2.5">
          <p className="text-[11.5px] font-semibold text-ink-400">보낸 문자</p>
          <p className="mt-0.5 break-words text-[13px] leading-relaxed text-ink-700">{message}</p>
        </div>
      ) : null}

      {paymentMock ? (
        <p className="rounded-xl bg-warning-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-700">
          [MOCK] 결제사 실연동 전입니다. 실제 출금은 일어나지 않습니다.
        </p>
      ) : null}

      {state.message && !state.ok ? (
        <p className="text-[13px] font-semibold text-danger-500">{state.message}</p>
      ) : null}

      <form action={formAction}>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="productId" value={mode === 'preset' ? productId : ''} />
        <input
          type="hidden"
          name="customAmount"
          value={mode === 'custom' && customAmount !== null ? customAmount.toString() : ''}
        />
        {isPhysical ? (
          <>
            <input type="hidden" name="quantity" value={String(qty)} />
            <input type="hidden" name="optionValues" value={JSON.stringify(opts)} />
            <input type="hidden" name="receiver" value={addr.receiver} />
            <input type="hidden" name="phone" value={addr.phone} />
            <input type="hidden" name="zipCode" value={addr.zipCode} />
            <input type="hidden" name="address1" value={addr.address1} />
            <input type="hidden" name="address2" value={addr.address2} />
            <input type="hidden" name="memo" value={addr.memo} />
          </>
        ) : null}
        <button
          type="submit"
          disabled={!valid || pending || state.ok}
          className="inline-flex h-14 w-full items-center justify-center rounded-2xl bg-brand-400 text-[16px] font-extrabold text-ink-900 transition-colors hover:bg-brand-500 disabled:cursor-not-allowed disabled:bg-ink-100 disabled:text-ink-300"
        >
          {state.ok
            ? 'PIN 입력 화면으로 이동합니다'
            : pending
              ? '처리 중'
              : valid && preview.total !== null
                ? `${formatWon(preview.total)} 결제하기`
                : isPhysical && !addressFilled
                  ? '배송지를 입력해 주세요'
                  : isPhysical && !optionsFilled
                    ? '옵션을 선택해 주세요'
                    : '상품을 선택해 주세요'}
        </button>
      </form>

      <p className="text-[11.5px] leading-relaxed text-ink-400">
        아직 결제되지 않았습니다. 다음 화면에서 결제 PIN 을 입력해야 출금이 진행됩니다.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[12px] text-ink-500">{label}</span>
      <span className="text-[12.5px] font-semibold tabular-nums text-ink-800">{value}</span>
    </div>
  );
}

function Text({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  inputMode?: 'numeric' | 'text';
}) {
  const id = React.useId();
  return (
    <div>
      <label className="text-[12px] font-semibold text-ink-600" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        inputMode={inputMode}
        className="mt-1 h-11 w-full rounded-xl border border-ink-200 px-3 text-[14px] outline-none focus:border-brand-400"
      />
    </div>
  );
}
