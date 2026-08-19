'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { cx } from '@/components/ui';

/**
 * 크리에이터 관리자 / 통합 관리자 공통 콘솔 레이아웃.
 * 좌측 LNB(그룹형) + 상단 바. 모바일에서는 드로어로 전환한다.
 */

export interface NavGroup {
  title: string;
  items: Array<{ href: string; label: string }>;
}

export function ConsoleShell({
  title,
  groups,
  user,
  children,
}: {
  title: string;
  groups: NavGroup[];
  user?: { name: string; role: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  return (
    <div className="min-h-dvh bg-[#f6f5f9]">
      <header className="sticky top-0 z-40 border-b border-ink-100/80 bg-white/92 backdrop-blur-xl">
        <div className="flex h-16 items-center justify-between gap-3 px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="메뉴"
              onClick={() => setOpen((v) => !v)}
              className="grid h-9 w-9 place-items-center rounded-lg border border-ink-200 text-ink-700 lg:hidden"
            >
              {open ? <X size={18} strokeWidth={1.6} /> : <Menu size={18} strokeWidth={1.6} />}
            </button>
            <Link href="/" className="hidden sm:block">
              <Logo compact />
            </Link>
            <span className="text-[15px] font-black tracking-[-0.025em] text-ink-900">{title}</span>
          </div>
          <div className="flex items-center gap-3">
            {user ? (
              <span className="hidden rounded-full bg-ink-50 px-3 py-1.5 text-[11px] font-semibold text-ink-500 sm:inline">
                {user.name} · {user.role}
              </span>
            ) : null}
            <form action="/api/auth/logout" method="post">
              <button className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-[11px] font-bold text-ink-700 shadow-sm transition-colors hover:bg-ink-50">
                로그아웃
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="relative flex items-start">
        {open ? <button type="button" aria-label="메뉴 닫기" onClick={() => setOpen(false)} className="fixed inset-0 top-16 z-20 bg-ink-900/25 backdrop-blur-[2px] lg:hidden" /> : null}
        <aside
          className={cx(
            'fixed inset-y-16 left-0 z-30 w-[260px] overflow-y-auto border-r border-ink-100 bg-white px-3 py-5 shadow-2xl lg:sticky lg:top-16 lg:ml-4 lg:mt-4 lg:block lg:h-[calc(100dvh-5rem)] lg:w-[244px] lg:rounded-[24px] lg:border lg:shadow-[0_14px_40px_rgba(23,20,45,0.08)]',
            open ? 'block' : 'hidden',
          )}
        >
          {groups.map((g) => (
            <div key={g.title} className="mb-5 last:mb-0">
              <p className="mb-2 px-3 text-[10px] font-extrabold tracking-[0.12em] text-ink-300">{g.title}</p>
              {g.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cx(
                      'block rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-all',
                      active ? 'bg-brand-50 font-extrabold text-brand-600 shadow-sm' : 'text-ink-500 hover:bg-ink-50 hover:text-ink-900',
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </aside>

        <main className="min-w-0 flex-1 px-4 py-5 lg:px-7 lg:py-7">
          <div className="mx-auto w-full max-w-[1480px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 rounded-[22px] border border-ink-100 bg-white px-5 py-5 shadow-[0_10px_30px_rgba(23,20,45,0.055)] sm:px-6">
      <div>
        <h1 className="text-[22px] font-black tracking-[-0.035em] text-ink-900">{title}</h1>
        {description ? <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-ink-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
