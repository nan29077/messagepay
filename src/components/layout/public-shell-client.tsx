'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home, Compass, HelpCircle, User, Menu, X, Receipt, Sparkles, Headphones, LogIn, LogOut, Bell, LayoutDashboard,
} from 'lucide-react';
import { Logo, TornadoMark } from '@/components/brand/logo';
import { DonationLookupSheet } from '@/components/public/donation-lookup-sheet';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { cx } from '@/components/ui';

/**
 * 공개 영역 레이아웃 (클라이언트).
 * - PC: 중앙 콘텐츠는 앱 폭 유지, 우측 세로 메뉴는 모바일 하단 내비와 동일한 5개 구성
 *       + 하단에 프로필/로그아웃(로그인) 영역
 * - 모바일: 하단 내비게이션 5개 (홈 / 이용방법 / 크리에이터 / FAQ / 마이페이지)
 * - 마이페이지는 로그인 역할에 따라 대시보드(/admin, /studio) 또는 마이페이지(/my)로 이동
 */

export interface ShellViewer {
  name: string | null;
  email: string | null;
  /** 역할별 마이페이지 목적지 (/admin, /studio, /my) */
  myHref: string;
  roleLabel: string;
  /** 프로필 캐릭터(아바타) 이미지. 크리에이터 프로필의 아바타를 그대로 사용한다. */
  avatarUrl: string | null;
}

/** 마이페이지 탭 활성 판정에 쓰는 콘솔 경로들 */
const MY_PREFIXES = ['/my', '/studio', '/admin'];

interface NavItem {
  href: string;
  label: string;
  icon: typeof Home;
  /** 마이페이지 탭(역할별 이동) */
  my?: boolean;
  /** 페이지 이동 대신 후원확인 바텀시트를 연다 */
  sheet?: boolean;
}

function buildNav(myHref: string): NavItem[] {
  return [
    { href: '/', label: '홈', icon: Home },
    { href: '/how-it-works', label: '이용방법', icon: Compass },
    { href: '#lookup', label: '후원확인', icon: Receipt, sheet: true },
    { href: '/faq', label: 'FAQ', icon: HelpCircle },
    { href: myHref, label: '마이페이지', icon: User, my: true },
  ];
}

const DRAWER_EXTRA = [
  { href: '/creator-apply', label: '크리에이터 가입', icon: Sparkles },
  { href: '/notice', label: '공지', icon: Bell },
  { href: '/support', label: '고객센터', icon: Headphones },
];

function isActive(pathname: string, href: string, my?: boolean) {
  if (my) return MY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PublicShellClient({
  children,
  aside,
  viewer,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
  viewer: ShellViewer | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const [lookupOpen, setLookupOpen] = React.useState(false);
  const myHref = viewer?.myHref ?? '/my';
  const nav = buildNav(myHref);

  const openLookup = React.useCallback(() => {
    setOpen(false);
    setLookupOpen(true);
  }, []);

  return (
    <div className="public-canvas min-h-dvh pb-20 lg:pb-0">
      <div className="mx-auto flex w-full max-w-[744px] items-start justify-center">
        <div className="min-h-dvh w-full min-w-0 max-w-[640px] bg-white shadow-[0_0_60px_rgba(23,22,26,0.10)]">
      <header className="sticky top-0 z-40 border-b border-ink-100/80 bg-white/88 backdrop-blur-xl">
        <div className="flex h-[68px] w-full items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="도네이도 홈">
            <Logo />
          </Link>

          <div className="flex items-center gap-2">
            {viewer ? <NotificationBell /> : null}
            <button
              type="button"
              aria-label="메뉴"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="grid h-10 w-10 place-items-center rounded-full border border-ink-200 bg-white text-ink-700 shadow-sm lg:hidden"
            >
              {open ? <X size={18} strokeWidth={1.6} /> : <Menu size={18} strokeWidth={1.6} />}
            </button>
          </div>
        </div>

        {open ? (
          <div className="border-t border-ink-100 bg-white px-4 py-3 lg:hidden">
            {[...nav, ...DRAWER_EXTRA].map((m) =>
              'sheet' in m && m.sheet ? (
                <button
                  key={m.href + m.label}
                  type="button"
                  onClick={openLookup}
                  className="block w-full rounded-lg px-2 py-3 text-left text-[15px] font-semibold text-ink-700"
                >
                  {m.label}
                </button>
              ) : (
                <Link
                  key={m.href + m.label}
                  href={m.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-2 py-3 text-[15px] font-semibold text-ink-700"
                >
                  {m.label}
                </Link>
              ),
            )}
            {viewer ? (
              <form action="/api/auth/logout" method="post" className="border-t border-ink-100 pt-2">
                <button
                  type="submit"
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-3 text-[15px] font-semibold text-ink-500"
                >
                  <LogOut size={16} strokeWidth={1.7} />
                  로그아웃
                </button>
              </form>
            ) : (
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-lg border-t border-ink-100 px-2 py-3 text-[15px] font-semibold text-brand-700"
              >
                <LogIn size={16} strokeWidth={1.7} />
                로그인
              </Link>
            )}
          </div>
        ) : null}
      </header>

      <main className="public-content px-4 py-5 sm:px-6 sm:py-7">{children}</main>

      <Footer />
        </div>

        {/* PC 우측 메뉴: 화면 세로 중앙에 붙는다 */}
        <aside
          className="sticky top-1/2 hidden max-h-[calc(100dvh-2rem)] w-[96px] shrink-0 -translate-y-1/2 self-start overflow-y-auto pl-2 lg:block"
          aria-label="PC 메뉴"
        >
          <nav className="flex w-full flex-col items-center gap-0.5 rounded-[24px] border border-white/80 bg-white/90 px-2 py-3 shadow-[0_16px_42px_rgba(23,22,26,0.12)] ring-1 ring-brand-100/35 backdrop-blur-xl">
            <Link
              href="/"
              aria-label="도네이도 홈"
              className="mb-2 grid h-10 w-10 place-items-center rounded-[14px] bg-white shadow-[0_6px_14px_rgba(237,166,0,0.22)] ring-1 ring-brand-200/60 transition-transform hover:-translate-y-0.5"
            >
              <TornadoMark size={26} />
            </Link>
            {nav.map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, item.href, item.my);
              const cls = cx(
                'group flex w-full flex-col items-center gap-0.5 rounded-[14px] py-2 text-[9.5px] font-bold transition-all',
                active ? 'bg-brand-50 text-brand-700 shadow-[inset_0_0_0_1px_rgba(237,166,0,0.14)]' : 'text-ink-400 hover:bg-ink-50 hover:text-ink-900',
              );
              const inner = (
                <>
                  <Icon size={18} strokeWidth={active ? 2 : 1.65} className="transition-transform group-hover:-translate-y-0.5" />
                  <span>{item.label}</span>
                </>
              );
              return item.sheet ? (
                <button key={item.href + item.label} type="button" onClick={openLookup} className={cls}>
                  {inner}
                </button>
              ) : (
                <Link
                  key={item.href + item.label}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cls}
                >
                  {inner}
                </Link>
              );
            })}

            <div className="mt-1.5 h-px w-8 bg-ink-100" />

            {viewer ? (
              <>
                <Link
                  href={myHref}
                  className="group mt-1.5 flex w-full flex-col items-center gap-1 rounded-[14px] py-2 text-ink-500 transition-colors hover:bg-ink-50"
                  aria-label="내 프로필"
                >
                  {viewer.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={viewer.avatarUrl}
                      alt=""
                      className="h-8 w-8 rounded-full border border-brand-200 object-cover"
                    />
                  ) : (
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-400 text-[12px] font-extrabold text-ink-900">
                      {(viewer.name ?? viewer.email ?? '?').slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="w-full truncate text-center text-[9px] font-bold text-ink-700">
                    {viewer.name ?? viewer.email ?? '사용자'}
                  </span>
                  <span className="text-[8px] font-semibold text-ink-300">{viewer.roleLabel}</span>
                </Link>
                <form action="/api/auth/logout" method="post" className="w-full">
                  <button
                    type="submit"
                    className="flex w-full flex-col items-center gap-0.5 rounded-[14px] py-2 text-[9.5px] font-bold text-ink-400 transition-colors hover:bg-ink-50 hover:text-ink-900"
                  >
                    <LogOut size={17} strokeWidth={1.65} />
                    <span>로그아웃</span>
                  </button>
                </form>
              </>
            ) : (
              <Link
                href="/login"
                className={cx(
                  'mt-1.5 flex w-full flex-col items-center gap-0.5 rounded-[14px] py-2 text-[9.5px] font-bold transition-all',
                  isActive(pathname, '/login')
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-ink-400 hover:bg-ink-50 hover:text-ink-900',
                )}
              >
                <LogIn size={18} strokeWidth={1.65} />
                <span>로그인</span>
              </Link>
            )}

            <p className="mt-2 text-[8px] font-extrabold tracking-[0.16em] text-ink-300">DONAIDO</p>
          </nav>
        </aside>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-100 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-[640px] grid-cols-5">
          {nav.map((t) => {
            const Icon = t.icon;
            const active = isActive(pathname, t.href, t.my);
            const cls = cx(
              'flex min-h-16 flex-col items-center justify-center gap-1 py-2 text-[11px] font-semibold',
              active ? 'text-brand-700' : 'text-ink-400',
            );
            const inner = (
              <>
                {t.my && viewer && viewer.myHref !== '/my' ? (
                  <LayoutDashboard size={20} strokeWidth={1.6} />
                ) : (
                  <Icon size={20} strokeWidth={1.6} />
                )}
                {t.label}
              </>
            );
            return t.sheet ? (
              <button key={t.href + t.label} type="button" onClick={openLookup} className={cls}>
                {inner}
              </button>
            ) : (
              <Link key={t.href + t.label} href={t.href} className={cls}>
                {inner}
              </Link>
            );
          })}
        </div>
      </nav>

      <DonationLookupSheet open={lookupOpen} onClose={() => setLookupOpen(false)} />
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
        <p>도네이도(DONAIDO) | 문자 기반 크리에이터 후원 플랫폼</p>
        <p className="mt-1">
          도네이도 후원은 유튜브 공식 슈퍼챗이 아닌 외부 후원 서비스입니다. 방송 채팅에는 크리에이터가 연결한 계정으로
          표시됩니다.
        </p>
        <p className="mt-1">현재 준비 단계로 실제 결제와 문자 발송은 비활성화되어 있습니다.</p>
      </div>
    </footer>
  );
}
