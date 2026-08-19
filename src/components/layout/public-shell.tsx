'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Compass, HelpCircle, User, Menu, X, Sparkles, Headphones, LogIn, Bell } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { cx } from '@/components/ui';

/**
 * 공개 영역 레이아웃.
 * - PC: 넓은 기업 홈페이지 형태를 만들지 않는다. 중앙 콘텐츠는 앱 폭 유지, 메뉴는 우측 정렬
 * - 모바일: 하단 내비게이션 + 한 손 조작 가능한 버튼 크기
 */

const MENU = [
  { href: '/', label: '홈', icon: Home },
  { href: '/how-it-works', label: '이용방법', icon: Compass },
  { href: '/creator-apply', label: '크리에이터', icon: Sparkles },
  { href: '/notice', label: '공지', icon: Bell },
  { href: '/faq', label: 'FAQ', icon: HelpCircle },
  { href: '/support', label: '고객센터', icon: Headphones },
  { href: '/login', label: '로그인', icon: LogIn },
];

const TABS = [
  { href: '/', label: '홈', icon: Home },
  { href: '/how-it-works', label: '이용방법', icon: Compass },
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
    <div className="public-canvas min-h-dvh pb-20 lg:pb-0">
      <div className="mx-auto flex w-full max-w-[744px] items-start justify-center">
        <div className="min-h-dvh w-full min-w-0 max-w-[640px] bg-white shadow-[0_0_60px_rgba(27,22,62,0.11)]">
      <header className="sticky top-0 z-40 border-b border-ink-100/80 bg-white/88 backdrop-blur-xl">
        <div className="flex h-[68px] w-full items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="토네이도 홈">
            <Logo />
          </Link>

          <button
            type="button"
            aria-label="메뉴"
            onClick={() => setOpen((v) => !v)}
            className="grid h-10 w-10 place-items-center rounded-full border border-ink-200 bg-white text-ink-700 shadow-sm lg:hidden"
          >
            {open ? <X size={18} strokeWidth={1.6} /> : <Menu size={18} strokeWidth={1.6} />}
          </button>
        </div>

        {open ? (
          <div className="border-t border-ink-100 bg-white px-4 py-3 lg:hidden">
            {MENU.map((m) => (
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

      <main className="public-content px-4 py-5 sm:px-6 sm:py-7">{children}</main>
      {aside ? <div className="sr-only">{aside}</div> : null}

      <Footer />
        </div>

        <aside className="sticky top-5 hidden w-[96px] shrink-0 self-start pl-2 lg:block" aria-label="PC 메뉴">
          <nav className="flex w-full flex-col items-center gap-0.5 rounded-[24px] border border-white/80 bg-white/90 px-2 py-3 shadow-[0_16px_42px_rgba(25,18,66,0.13)] ring-1 ring-brand-100/35 backdrop-blur-xl">
            <div className="mb-1.5 grid h-8 w-8 place-items-center rounded-xl bg-brand-50 text-brand-600">
              <span className="h-2.5 w-2.5 rounded-full border-2 border-brand-400 shadow-[0_0_0_4px_rgba(114,72,245,0.10)]" />
            </div>
            {MENU.map((item) => {
              const Icon = item.icon;
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'group flex w-full flex-col items-center gap-0.5 rounded-[14px] py-2 text-[9.5px] font-bold transition-all',
                    active ? 'bg-brand-50 text-brand-600 shadow-[inset_0_0_0_1px_rgba(114,72,245,0.08)]' : 'text-ink-400 hover:bg-ink-50 hover:text-ink-900',
                  )}
                >
                  <Icon size={18} strokeWidth={active ? 2 : 1.65} className="transition-transform group-hover:-translate-y-0.5" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
            <div className="mt-1.5 h-px w-8 bg-ink-100" />
            <p className="mt-2 text-[8px] font-extrabold tracking-[0.16em] text-ink-300">TORNADO</p>
          </nav>
        </aside>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-100 bg-white/95 backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-[640px] grid-cols-4">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = pathname === t.href;
            return (
              <Link
                key={t.href}
                href={t.href}
                className={cx(
                  'flex min-h-16 flex-col items-center justify-center gap-1 py-2 text-[11px] font-semibold',
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
