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
    <header className="mb-5">
      {eyebrow ? <p className="text-[12px] font-bold tracking-wide text-brand-600">{eyebrow}</p> : null}
      <h1 className="mt-1 text-[24px] font-extrabold leading-snug tracking-tight text-ink-900">{title}</h1>
      {description ? <p className="mt-2 text-[13.5px] leading-relaxed text-ink-500">{description}</p> : null}
    </header>
  );
}
