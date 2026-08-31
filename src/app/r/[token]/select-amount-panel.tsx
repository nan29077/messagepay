'use client';

import * as React from 'react';
import { Pencil } from 'lucide-react';
import { cx } from '@/components/ui';
import { formatWon } from '@/lib/money';
import { confirmChargeAmountAction, type SelectAmountState } from '@/app/actions/charge-select';

/**
 * 충전 금액 선택 화면.
 *
 * 상품을 고르거나 직접 입력한 뒤 [충전하기] 를 누르면 그 자리에서 결제사 PIN 입력 화면으로 넘어간다.
 * 문자를 한 번 더 보내지 않는다.
 */

const initial: SelectAmountState = { ok: false };

export function SelectAmountPanel({
  token,
  creatorName,
  products,
  allowCustom,
  minAmount,
  maxAmount,
  message,
  paymentMock,
}: {
  token: string;
  creatorName: string;
  products: { id: string; name: string; amount: string }[];
  allowCustom: boolean;
  minAmount: string;
  maxAmount: string;
  message: string;
  paymentMock: boolean;
}) {
  const min = BigInt(minAmount);
  const max = BigInt(maxAmount);

  const [state, formAction, pending] = React.useActionState(confirmChargeAmountAction, initial);
  const [productId, setProductId] = React.useState<string>(products[0]?.id ?? '');
  const [custom, setCustom] = React.useState('');
  const [mode, setMode] = React.useState<'preset' | 'custom'>(
    products.length > 0 ? 'preset' : 'custom',
  );

  // 결제사 PIN 화면으로 이동. 성공 응답에 담긴 주소는 1회용이다.
  React.useEffect(() => {
    if (state.ok && state.pinUrl) window.location.href = state.pinUrl;
  }, [state.ok, state.pinUrl]);

  const customAmount = React.useMemo(() => {
    const digits = custom.replace(/[^\d]/g, '');
    if (!digits) return null;
    try {
      return BigInt(digits);
    } catch {
      return null;
    }
  }, [custom]);

  const selected = products.find((p) => p.id === productId);
  const effective =
    mode === 'custom' ? customAmount : selected ? BigInt(selected.amount) : null;
  const valid = effective !== null && effective >= min && effective <= max;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[13px] font-bold text-ink-900">충전 금액</p>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-500">
          {creatorName} 에 충전할 금액을 골라 주세요. 결제 금액과 지급 포인트는 같습니다.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {products.map((p) => {
            const active = mode === 'preset' && productId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setMode('preset');
                  setProductId(p.id);
                }}
                className={cx(
                  'min-h-14 rounded-2xl px-3.5 py-2.5 text-left transition-colors',
                  active ? 'bg-ink-900 text-brand-400' : 'bg-ink-50 text-ink-800 hover:bg-ink-100',
                )}
              >
                <span className="block text-[13.5px] font-bold leading-tight">{p.name}</span>
                <span className="block text-[12px] font-semibold opacity-80">
                  {formatWon(BigInt(p.amount))}
                </span>
              </button>
            );
          })}

          {allowCustom ? (
            <button
              type="button"
              onClick={() => setMode('custom')}
              className={cx(
                'flex min-h-14 items-center justify-center gap-1.5 rounded-2xl px-3.5 text-[13.5px] font-bold transition-colors',
                mode === 'custom' ? 'bg-ink-900 text-brand-400' : 'bg-ink-50 text-ink-700 hover:bg-ink-100',
              )}
            >
              <Pencil size={14} strokeWidth={1.9} />
              직접 입력
            </button>
          ) : null}
        </div>

        {mode === 'custom' ? (
          <div className="mt-3">
            <div className="flex items-center gap-2">
              <input
                inputMode="numeric"
                value={custom}
                onChange={(e) => setCustom(e.target.value.replace(/[^\d]/g, ''))}
                placeholder={`${min.toString()} ~ ${max.toString()}`}
                aria-label="직접 입력 충전 금액"
                className="h-12 w-44 rounded-xl border border-ink-200 px-3.5 text-right text-[15px] font-bold tabular-nums outline-none focus:border-brand-400"
              />
              <span className="text-[14px] font-bold text-ink-700">원</span>
            </div>
            {!valid && custom ? (
              <p className="mt-1.5 text-[12px] font-semibold text-danger-500">
                {formatWon(min)} ~ {formatWon(max)} 사이로 입력해 주세요.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

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
        <button
          type="submit"
          disabled={!valid || pending || state.ok}
          className="inline-flex h-14 w-full items-center justify-center rounded-2xl bg-brand-400 text-[16px] font-extrabold text-ink-900 transition-colors hover:bg-brand-500 disabled:cursor-not-allowed disabled:bg-ink-100 disabled:text-ink-300"
        >
          {state.ok
            ? 'PIN 입력 화면으로 이동합니다'
            : pending
              ? '처리 중'
              : valid && effective !== null
                ? `${formatWon(effective)} 충전하기`
                : '충전 금액을 선택해 주세요'}
        </button>
      </form>

      <p className="text-[11.5px] leading-relaxed text-ink-400">
        아직 결제되지 않았습니다. 다음 화면에서 결제 PIN 을 입력해야 출금이 진행됩니다.
      </p>
    </div>
  );
}
