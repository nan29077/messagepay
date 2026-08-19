import * as React from 'react';
import Link from 'next/link';

/**
 * 토네이도 공통 UI 프리미티브.
 * - 이모지를 사용하지 않는다. 아이콘은 lucide-react 라인 아이콘만 사용한다.
 * - 카드형 UI, 둥근 모서리, 부드러운 그림자, 충분한 여백.
 */

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

// --------------------------------------------------------------------- Button

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
type ButtonSize = 'sm' | 'md' | 'lg';

const buttonBase =
  'inline-flex items-center justify-center gap-2 font-extrabold transition-all disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 active:scale-[0.985]';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-brand-500 text-white shadow-[0_8px_20px_rgba(114,72,245,0.22)] hover:-translate-y-0.5 hover:bg-brand-600 active:bg-brand-700',
  accent: 'bg-accent-500 text-white shadow-[0_8px_20px_rgba(255,107,107,0.2)] hover:-translate-y-0.5 hover:bg-accent-600',
  secondary: 'bg-white text-ink-900 border border-ink-200 shadow-sm hover:-translate-y-0.5 hover:bg-ink-50',
  ghost: 'bg-transparent text-ink-500 hover:bg-ink-100',
  danger: 'bg-danger-500 text-white hover:opacity-90',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-[12.5px] rounded-xl',
  md: 'h-11 px-4.5 text-[14px] rounded-xl',
  lg: 'h-14 px-6 text-[15px] rounded-2xl w-full',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={cx(buttonBase, buttonVariants[variant], buttonSizes[size], className)} {...props} />;
}

export function LinkButton({
  href,
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: React.ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <Link href={href} className={cx(buttonBase, buttonVariants[variant], buttonSizes[size], className)} {...props}>
      {children}
    </Link>
  );
}

// ----------------------------------------------------------------------- Card

export function Card({
  className,
  padded = true,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { padded?: boolean }) {
  return <div className={cx('card', padded && 'p-5 sm:p-6', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cx('text-[15px] font-bold text-ink-900', className)} {...props} />;
}

export function SectionTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3.5 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-[18px] font-black tracking-[-0.025em] text-ink-900 sm:text-[19px]">{title}</h2>
        {description ? <p className="mt-1 text-[13px] leading-relaxed text-ink-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------- Badge

type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';

const toneClass: Record<Tone, string> = {
  neutral: 'bg-ink-100 text-ink-500',
  brand: 'bg-brand-50 text-brand-600',
  success: 'bg-success-50 text-success-500',
  warning: 'bg-warning-50 text-warning-500',
  danger: 'bg-danger-50 text-danger-500',
};

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap',
        toneClass[tone],
        className,
      )}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------- Input

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        'h-12 w-full rounded-xl border border-ink-200 bg-white px-4 text-[15px] text-ink-900 placeholder:text-ink-300',
        'focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cx(
        'w-full rounded-xl border border-ink-200 bg-white px-4 py-3 text-[15px] text-ink-900 placeholder:text-ink-300',
        'focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100',
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        'h-12 w-full rounded-xl border border-ink-200 bg-white px-3 text-[15px] text-ink-900',
        'focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100',
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 text-[13px] font-semibold text-ink-700">
        {label}
        {required ? <span className="text-accent-500">*</span> : null}
      </span>
      {children}
      {hint ? <span className="mt-1.5 block text-[12px] leading-relaxed text-ink-400">{hint}</span> : null}
    </label>
  );
}

export function Checkbox({
  label,
  description,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode; description?: string }) {
  return (
    <label className={cx('flex cursor-pointer items-start gap-3 py-2', className)}>
      <input
        type="checkbox"
        className="mt-0.5 h-5 w-5 shrink-0 rounded-md border-ink-300 text-brand-500 focus:ring-brand-300"
        {...props}
      />
      <span>
        <span className="block text-[14px] leading-snug text-ink-900">{label}</span>
        {description ? <span className="mt-0.5 block text-[12px] text-ink-400">{description}</span> : null}
      </span>
    </label>
  );
}

// ----------------------------------------------------------------------- Misc

export function StatTile({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
}) {
  const valueTone =
    tone === 'brand' ? 'text-brand-600'
    : tone === 'success' ? 'text-success-500'
    : tone === 'danger' ? 'text-danger-500'
    : tone === 'warning' ? 'text-warning-500'
    : 'text-ink-900';
  return (
    <div className="card min-h-[112px] p-4 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] sm:p-5">
      <p className="text-[11.5px] font-bold text-ink-400">{label}</p>
      <p className={cx('mt-2 text-[23px] font-black tracking-[-0.035em] tabular-nums', valueTone)}>{value}</p>
      {sub ? <p className="mt-1 text-[11px] leading-relaxed text-ink-400">{sub}</p> : null}
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-ink-200 px-6 py-10 text-center">
      <p className="text-[14px] font-semibold text-ink-700">{title}</p>
      {description ? <p className="mt-1.5 text-[13px] text-ink-400">{description}</p> : null}
    </div>
  );
}

export function Notice({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children: React.ReactNode;
}) {
  const border =
    tone === 'warning' ? 'border-warning-500/30 bg-warning-50'
    : tone === 'danger' ? 'border-danger-500/30 bg-danger-50'
    : tone === 'success' ? 'border-success-500/30 bg-success-50'
    : tone === 'brand' ? 'border-brand-200 bg-brand-50'
    : 'border-ink-200 bg-white';
  return (
    <div className={cx('rounded-xl border px-4 py-3', border)}>
      {title ? <p className="mb-1 text-[13px] font-bold text-ink-900">{title}</p> : null}
      <div className="text-[13px] leading-relaxed text-ink-700">{children}</div>
    </div>
  );
}

export function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-ink-100 py-2.5 last:border-0">
      <span className="text-[13px] text-ink-400">{label}</span>
      <span className="text-right text-[13px] font-semibold text-ink-900">{value}</span>
    </div>
  );
}

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto rounded-[20px] border border-ink-100 bg-white shadow-[0_10px_30px_rgba(23,20,45,0.05)]', className)}>
      <table className="w-full min-w-[720px] border-collapse text-[13px]">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={cx('whitespace-nowrap border-b border-ink-100 bg-ink-50/70 px-3 py-3 text-left text-[11.5px] font-extrabold text-ink-500', className)}>
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cx('border-b border-ink-100 px-3 py-3 align-top text-ink-700', className)}>{children}</td>;
}
