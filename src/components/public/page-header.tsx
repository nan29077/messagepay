import * as React from 'react';

/**
 * 공개 페이지 공통 헤더.
 * PublicShell 안에서 각 페이지 최상단에 사용한다.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <header className="relative mb-6 overflow-hidden rounded-[26px] border border-brand-100 bg-[linear-gradient(135deg,#f4f0ff_0%,#fff_58%,#fff3f3_100%)] px-5 py-6 shadow-[0_14px_34px_rgba(45,28,103,0.08)] sm:px-7 sm:py-8">
      <span className="absolute -right-8 -top-10 h-32 w-32 rounded-full bg-brand-200/35 blur-2xl" aria-hidden />
      <span className="absolute -bottom-12 left-1/3 h-24 w-24 rounded-full bg-accent-400/15 blur-2xl" aria-hidden />
      <div className="relative">
      {eyebrow ? <p className="text-[10px] font-extrabold tracking-[0.18em] text-brand-600">{eyebrow}</p> : null}
      <h1 className="mt-2 text-[26px] font-black leading-[1.2] tracking-[-0.04em] text-ink-900 sm:text-[31px]">{title}</h1>
      {description ? <p className="mt-3 max-w-[520px] text-[13.5px] leading-relaxed text-ink-500 sm:text-[14px]">{description}</p> : null}
      </div>
    </header>
  );
}
