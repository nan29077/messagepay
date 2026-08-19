'use client';

import * as React from 'react';
import { Button, Notice, cx } from '@/components/ui';
import { SecretBox } from '@/components/studio/copy';
import type { StudioActionState } from '@/app/actions/studio';

/**
 * 크리에이터 관리자 공용 액션 폼.
 * 서버 컴포넌트에서 필드를 children 으로 넘기고, 서버 액션을 그대로 전달한다.
 */

type StudioAction = (prev: StudioActionState, formData: FormData) => Promise<StudioActionState>;

const initial: StudioActionState = { ok: false };

export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = '처리 중',
  variant = 'primary',
  size = 'md',
  confirmMessage,
  className,
}: {
  action: StudioAction;
  children?: React.ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
  size?: 'sm' | 'md' | 'lg';
  confirmMessage?: string;
  className?: string;
}) {
  const [state, formAction, pending] = React.useActionState(action, initial);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) e.preventDefault();
      }}
      className={cx('space-y-3.5', className)}
    >
      {children}

      {state.secret ? (
        <SecretBox label={state.secretLabel ?? '발급된 값'} value={state.secret} hint={state.secretHint} />
      ) : null}

      {state.message ? (
        <Notice tone={state.ok ? 'success' : 'danger'}>{state.message}</Notice>
      ) : null}

      <Button type="submit" variant={variant} size={size} disabled={pending}>
        {pending ? pendingLabel : submitLabel}
      </Button>
    </form>
  );
}

/** 테이블 행 등에 들어가는 소형 액션 버튼 */
export function InlineActionForm({
  action,
  submitLabel,
  pendingLabel = '처리 중',
  variant = 'secondary',
  confirmMessage,
  fields,
  disabled,
  disabledReason,
}: {
  action: StudioAction;
  submitLabel: string;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
  confirmMessage?: string;
  fields: Record<string, string>;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [state, formAction, pending] = React.useActionState(action, initial);

  if (disabled) {
    return <span className="text-[12px] text-ink-300">{disabledReason ?? '처리 불가'}</span>;
  }

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) e.preventDefault();
      }}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Button type="submit" variant={variant} size="sm" disabled={pending}>
        {pending ? pendingLabel : submitLabel}
      </Button>
      {state.message ? (
        <span className={cx('mt-1 block text-[11.5px] leading-snug', state.ok ? 'text-success-500' : 'text-danger-500')}>
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
