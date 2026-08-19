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
    <div className="min-h-dvh bg-ink-50">
      <header className="sticky top-0 z-40 border-b border-ink-100 bg-white">
        <div className="flex h-14 items-center justify-between gap-3 px-4">
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
            <span className="text-[15px] font-extrabold tracking-tight text-ink-900">{title}</span>
          </div>
          <div className="flex items-center gap-3">
            {user ? (
              <span className="text-[12px] text-ink-400">
                {user.name} · {user.role}
              </span>
            ) : null}
            <form action="/api/auth/logout" method="post">
              <button className="rounded-lg border border-ink-200 px-3 py-1.5 text-[12px] font-semibold text-ink-700">
                로그아웃
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="flex">
        <aside
          className={cx(
            'fixed inset-y-14 left-0 z-30 w-64 overflow-y-auto border-r border-ink-100 bg-white px-3 py-4 lg:sticky lg:top-14 lg:block lg:h-[calc(100dvh-3.5rem)]',
            open ? 'block' : 'hidden',
          )}
        >
          {groups.map((g) => (
            <div key={g.title} className="mb-5">
              <p className="mb-1.5 px-2 text-[11px] font-bold tracking-wide text-ink-300">{g.title}</p>
              {g.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cx(
                      'block rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors',
                      active ? 'bg-brand-50 font-bold text-brand-600' : 'text-ink-500 hover:bg-ink-50 hover:text-ink-900',
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </aside>

        <main className="min-w-0 flex-1 px-4 py-5 lg:px-6">{children}</main>
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
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[20px] font-extrabold tracking-tight text-ink-900">{title}</h1>
        {description ? <p className="mt-1 text-[13px] text-ink-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
