'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '@/components/ui';

const TABS = [
  { href: '/my', label: '후원 내역' },
  { href: '/my/payments', label: '결제 내역' },
  { href: '/my/account', label: '등록 계좌' },
  { href: '/my/limits', label: '한도 설정' },
  { href: '/my/blocks', label: '후원 차단' },
  { href: '/my/consents', label: '동의 이력' },
];

export function MyNav() {
  const pathname = usePathname();
  return (
    <nav className="mb-5 -mx-4 overflow-x-auto px-4">
      <div className="flex w-max gap-1.5">
        {TABS.map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cx(
                'whitespace-nowrap rounded-xl border px-3.5 py-2 text-[13.5px] font-semibold transition-colors',
                active
                  ? 'border-brand-500 bg-brand-500 text-white'
                  : 'border-ink-200 bg-white text-ink-500 hover:text-ink-900',
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
