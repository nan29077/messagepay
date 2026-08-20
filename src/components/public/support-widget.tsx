'use client';

import * as React from 'react';
import Link from 'next/link';
import { MessageCircleQuestion, X, ChevronDown, Send, RotateCw } from 'lucide-react';
import { cx, Notice } from '@/components/ui';
import { sendInquiryMessage, type InquiryActionState } from '@/app/actions/inquiry';

/**
 * 우측 하단 플로팅 문의 위젯.
 *
 * - PC(sm+): 우측 메뉴바 아래(우하단 모서리)에 버튼 고정, 패널은 버튼 위로 열린다.
 * - 모바일: 하단 탭바를 가리지 않도록 탭바 위쪽에 버튼을 띄운다.
 * - 탭 1) 자주 묻는 질문: 상위 FAQ 아코디언 + 전체 보기 링크
 * - 탭 2) 1:1 문의: 채팅형 문의. 비로그인도 가능(게스트 쿠키), 답변은 15초 간격 폴링으로 수신.
 */

export interface WidgetFaq {
  id: string;
  title: string;
  body: string;
}

interface ThreadMessage {
  id: string;
  sender: 'USER' | 'ADMIN';
  body: string;
  at: string;
}

const initialState: InquiryActionState = { ok: false };

export function SupportWidget({ faqs, loggedIn }: { faqs: WidgetFaq[]; loggedIn: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState<'faq' | 'chat'>('faq');
  const [messages, setMessages] = React.useState<ThreadMessage[]>([]);
  const [status, setStatus] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [openFaq, setOpenFaq] = React.useState<string | null>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const [state, formAction, pending] = React.useActionState(sendInquiryMessage, initialState);
  const formRef = React.useRef<HTMLFormElement>(null);

  const loadThread = React.useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/inquiry', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { exists: boolean; status: string | null; unreadCount: number; messages: ThreadMessage[] };
      setMessages(data.messages);
      setStatus(data.status);
      setUnreadCount(open && tab === 'chat' ? 0 : data.unreadCount);
    } catch {
      /* 네트워크 오류는 다음 폴링에서 회복 */
    } finally {
      setLoading(false);
    }
  }, [open, tab]);

  // 창이 닫혀 있어도 관리자 답변 도착 여부만 가볍게 확인한다.
  React.useEffect(() => {
    if (open) return;
    const peek = async () => {
      try {
        const res = await fetch('/api/inquiry?peek=1', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json() as { unreadCount?: number };
        setUnreadCount(data.unreadCount ?? 0);
      } catch { /* 다음 확인에서 회복 */ }
    };
    void peek();
    const timer = window.setInterval(peek, 30_000);
    return () => window.clearInterval(timer);
  }, [open]);

  // 채팅 탭이 열려 있는 동안 15초 간격 폴링
  React.useEffect(() => {
    if (!open || tab !== 'chat') return;
    const first = window.setTimeout(loadThread, 0);
    const timer = window.setInterval(loadThread, 15000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [open, tab, loadThread]);

  // 전송 성공 시 폼 비우고 스레드 새로고침 (ref 접근이 있으므로 effect 로 처리)
  React.useEffect(() => {
    if (!state.ok) return;
    formRef.current?.reset();
    const t = window.setTimeout(loadThread, 0);
    return () => window.clearTimeout(t);
  }, [state, loadThread]);

  // 새 메시지가 오면 맨 아래로 스크롤
  React.useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, open, tab]);

  const needGuestFields = !loggedIn && messages.length === 0;

  return (
    <>
      {/* 플로팅 버튼: 모바일은 하단 탭바(약 64px + safe-area) 위, PC 는 우하단 모서리 */}
      <button
        type="button"
        aria-label={open ? '문의 창 닫기' : '문의하기'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cx(
          'fixed z-50 flex items-center justify-center rounded-full bg-ink-900 text-brand-400 shadow-[0_10px_28px_rgba(23,22,26,0.35)] transition-transform hover:-translate-y-0.5 active:translate-y-0',
          'right-4 bottom-[calc(76px+env(safe-area-inset-bottom))] lg:right-auto lg:left-[calc(50%+278px)] lg:bottom-5',
          'h-[52px] w-[52px]',
        )}
      >
        {open ? <X size={22} strokeWidth={1.8} /> : <MessageCircleQuestion size={24} strokeWidth={1.8} />}
        {!open && unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-danger-500 px-1 text-[10px] font-black text-white ring-2 ring-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>

      {/* 패널 */}
      {open ? (
        <div
          role="dialog"
          aria-label="고객 문의"
          className={cx(
            'fixed z-50 flex flex-col overflow-hidden rounded-[22px] border border-ink-100 bg-white shadow-[0_30px_80px_rgba(23,22,26,0.28)]',
            'inset-x-3 bottom-[calc(140px+env(safe-area-inset-bottom))] top-auto max-h-[62dvh]',
            'sm:inset-x-auto sm:right-6 sm:bottom-[92px] sm:h-[560px] sm:max-h-[calc(100dvh-120px)] sm:w-[370px]',
            'lg:left-[calc(50%+8px)] lg:right-auto lg:bottom-[84px]',
          )}
        >
          {/* 헤더 */}
          <div className="flex items-center justify-between bg-ink-900 px-4 py-3.5">
            <div>
              <p className="text-[14px] font-black tracking-[-0.02em] text-white">무엇을 도와드릴까요?</p>
              <p className="mt-0.5 text-[11px] text-white/60">자주 묻는 질문을 확인하거나 1:1 문의를 남겨주세요.</p>
            </div>
          </div>

          {/* 탭 */}
          <div className="grid grid-cols-2 border-b border-ink-100">
            {(
              [
                { key: 'faq', label: '자주 묻는 질문' },
                { key: 'chat', label: '1:1 문의' },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cx(
                  'h-11 text-[13px] font-bold transition-colors',
                  tab === t.key ? 'border-b-2 border-brand-500 text-ink-900' : 'text-ink-400 hover:text-ink-700',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* FAQ 탭 */}
          {tab === 'faq' ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {faqs.length === 0 ? (
                <p className="px-2 py-6 text-center text-[13px] text-ink-400">등록된 FAQ가 없습니다.</p>
              ) : (
                <div className="space-y-1.5">
                  {faqs.map((f) => {
                    const opened = openFaq === f.id;
                    return (
                      <div key={f.id} className="rounded-xl border border-ink-100">
                        <button
                          type="button"
                          onClick={() => setOpenFaq(opened ? null : f.id)}
                          aria-expanded={opened}
                          className="flex w-full items-center justify-between gap-2 px-3.5 py-3 text-left"
                        >
                          <span className="text-[13px] font-bold text-ink-900">{f.title}</span>
                          <ChevronDown
                            size={15}
                            strokeWidth={1.8}
                            className={cx('shrink-0 text-ink-300 transition-transform', opened && 'rotate-180')}
                          />
                        </button>
                        {opened ? (
                          <p className="border-t border-ink-100 px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-600">
                            {f.body}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Link
                  href="/faq"
                  onClick={() => setOpen(false)}
                  className="flex h-10 items-center justify-center rounded-xl border border-ink-200 text-[12.5px] font-bold text-ink-700 hover:bg-ink-50"
                >
                  FAQ 전체 보기
                </Link>
                <button
                  type="button"
                  onClick={() => setTab('chat')}
                  className="flex h-10 items-center justify-center rounded-xl bg-brand-400 text-[12.5px] font-extrabold text-ink-900 hover:bg-brand-500"
                >
                  1:1 문의하기
                </button>
              </div>
            </div>
          ) : null}

          {/* 채팅 탭 */}
          {tab === 'chat' ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                {messages.length === 0 ? (
                  <div className="rounded-xl bg-ink-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-600">
                    안녕하세요, 도네이도입니다. 궁금한 점을 남겨주시면 순차적으로 답변해 드립니다.
                    {loggedIn ? '' : ' 비회원도 문의할 수 있으며, 답변은 이 창에서 확인할 수 있습니다.'}
                  </div>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className={cx('flex', m.sender === 'USER' ? 'justify-end' : 'justify-start')}>
                      <div
                        className={cx(
                          'max-w-[82%] rounded-2xl px-3 py-2',
                          m.sender === 'USER' ? 'bg-brand-400 text-ink-900' : 'bg-ink-50 text-ink-900',
                        )}
                      >
                        <p className="whitespace-pre-line break-words text-[12.5px] leading-relaxed">{m.body}</p>
                        <p className={cx('mt-0.5 text-[10px] tabular-nums', m.sender === 'USER' ? 'text-ink-900/50' : 'text-ink-400')}>
                          {new Date(m.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  ))
                )}
                {status === 'ANSWERED' ? (
                  <p className="text-center text-[11px] text-ink-400">답변이 등록되었습니다. 추가 문의가 있으면 이어서 보내주세요.</p>
                ) : null}
                {status === 'CLOSED' ? (
                  <p className="text-center text-[11px] text-ink-400">종결된 문의입니다. 새 메시지를 보내면 다시 접수됩니다.</p>
                ) : null}
              </div>

              <form ref={formRef} action={formAction} className="border-t border-ink-100 p-3">
                <select
                  name="category"
                  aria-label="문의 유형"
                  className="mb-2 h-9 w-full rounded-lg border border-ink-200 bg-white px-2.5 text-[12px] font-semibold text-ink-700 outline-none focus:border-brand-400"
                >
                  <option value="일반">문의 유형을 선택해 주세요</option>
                  <option value="결제·후원">결제·후원</option>
                  <option value="크리에이터">크리에이터</option>
                  <option value="계정">계정</option>
                  <option value="방송 연동">방송 연동</option>
                  <option value="기타">기타</option>
                </select>
                {needGuestFields ? (
                  <div className="mb-2 grid grid-cols-2 gap-2">
                    <input
                      name="guestName"
                      placeholder="이름 (선택)"
                      maxLength={30}
                      className="h-9 rounded-lg border border-ink-200 px-2.5 text-[12px] outline-none focus:border-brand-400"
                    />
                    <input
                      name="contact"
                      placeholder="회신 연락처 (선택)"
                      maxLength={80}
                      className="h-9 rounded-lg border border-ink-200 px-2.5 text-[12px] outline-none focus:border-brand-400"
                    />
                  </div>
                ) : null}
                <div className="flex items-end gap-2">
                  <textarea
                    name="body"
                    rows={2}
                    maxLength={1000}
                    required
                    placeholder="문의 내용을 입력해 주세요"
                    className="min-h-[44px] flex-1 resize-none rounded-xl border border-ink-200 px-3 py-2.5 text-[13px] leading-relaxed outline-none focus:border-brand-400"
                  />
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      aria-label="새로고침"
                      onClick={() => loadThread()}
                      className="grid h-9 w-11 place-items-center rounded-lg border border-ink-200 text-ink-400 hover:text-ink-900"
                    >
                      <RotateCw size={14} strokeWidth={1.8} className={loading ? 'animate-spin' : undefined} />
                    </button>
                    <button
                      type="submit"
                      disabled={pending}
                      aria-label="보내기"
                      className="grid h-9 w-11 place-items-center rounded-lg bg-brand-400 text-ink-900 hover:bg-brand-500 disabled:opacity-60"
                    >
                      <Send size={15} strokeWidth={1.8} />
                    </button>
                  </div>
                </div>
                {state.message && !state.ok ? (
                  <div className="mt-2">
                    <Notice tone="warning">{state.message}</Notice>
                  </div>
                ) : null}
              </form>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
