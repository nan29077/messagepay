'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Search, HelpCircle, User, Menu, X } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { cx } from '@/components/ui';

/**
 * 공개 영역 레이아웃.
 * - PC: 넓은 기업 홈페이지 형태를 만들지 않는다. 중앙 콘텐츠는 앱 폭 유지, 메뉴는 우측 정렬
 * - 모바일: 하단 내비게이션 + 한 손 조작 가능한 버튼 크기
 */

const MENU = [
  { href: '/how-it-works', label: '이용방법' },
  { href: '/creator-apply', label: '크리에이터 신청' },
  { href: '/faq', label: 'FAQ' },
  { href: '/support', label: '고객센터' },
];

const TABS = [
  { href: '/', label: '홈', icon: Home },
  { href: '/how-it-works', label: '이용방법', icon: Search },
  { href: '/faq', label: 'FAQ', icon: HelpCircle },
  { href: '/my', label: '내 후원', icon: User },
];

export function PublicShell({
  children,
  aside,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  return (
    <div className="min-h-dvh bg-ink-50 pb-20 lg:pb-0">
      <header className="sticky top-0 z-40 border-b border-ink-100 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4">
          <Link href="/" aria-label="토네이도 홈">
            <Logo />
          </Link>

          <nav className="hidden items-center gap-1 lg:flex">
            {MENU.map((m) => (
              <Link
                key={m.href}
                href={m.href}
                className={cx(
                  'rounded-lg px-3 py-2 text-[14px] font-semibold transition-colors',
                  pathname === m.href ? 'text-brand-600' : 'text-ink-500 hover:text-ink-900',
                )}
              >
                {m.label}
              </Link>
            ))}
            <Link
              href="/login"
              className="ml-2 rounded-xl border border-ink-200 px-4 py-2 text-[14px] font-semibold text-ink-900 hover:bg-ink-50"
            >
              로그인
            </Link>
          </nav>

          <button
            type="button"
            aria-label="메뉴"
            onClick={() => setOpen((v) => !v)}
            className="grid h-10 w-10 place-items-center rounded-xl border border-ink-200 text-ink-700 lg:hidden"
          >
            {open ? <X size={18} strokeWidth={1.6} /> : <Menu size={18} strokeWidth={1.6} />}
          </button>
        </div>

        {open ? (
          <div className="border-t border-ink-100 bg-white px-4 py-3 lg:hidden">
            {[...MENU, { href: '/login', label: '로그인' }].map((m) => (
              <Link
                key={m.href}
                href={m.href}
                onClick={() => setOpen(false)}
                className="block rounded-lg px-2 py-3 text-[15px] font-semibold text-ink-700"
              >
                {m.label}
              </Link>
            ))}
          </div>
        ) : null}
      </header>

      <div className="mx-auto flex w-full max-w-6xl gap-8 px-4 py-6">
        <main className="app-column flex-1">{children}</main>
        {aside ? <aside className="hidden w-[300px] shrink-0 lg:block">{aside}</aside> : null}
      </div>

      <Footer />

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-100 bg-white/95 backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-4">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = pathname === t.href;
            return (
              <Link
                key={t.href}
                href={t.href}
                className={cx(
                  'flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold',
                  active ? 'text-brand-600' : 'text-ink-400',
                )}
              >
                <Icon size={20} strokeWidth={1.6} />
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function Footer() {
  return (
    <footer className="mt-10 border-t border-ink-100 bg-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 text-[12px] leading-relaxed text-ink-400">
        <div className="mb-4 flex flex-wrap gap-x-4 gap-y-2 text-[13px] font-semibold text-ink-700">
          <Link href="/terms">이용약관</Link>
          <Link href="/privacy">개인정보처리방침</Link>
          <Link href="/terms/e-finance">전자금융거래약관</Link>
          <Link href="/support">고객센터</Link>
        </div>
        <p>토네이도(TORNADO) | 문자 기반 크리에이터 후원 플랫폼</p>
        <p className="mt-1">
          토네이도 후원은 유튜브 공식 슈퍼챗이 아닌 외부 후원 서비스입니다. 방송 채팅에는 크리에이터가 연결한 계정으로
          표시됩니다.
        </p>
        <p className="mt-1">현재 준비 단계로 실제 결제와 문자 발송은 비활성화되어 있습니다.</p>
      </div>
    </footer>
  );
}
