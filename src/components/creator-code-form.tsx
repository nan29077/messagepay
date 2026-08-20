'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Search } from 'lucide-react';
import { Button, Input, Notice } from '@/components/ui';
import { lookupCreatorCode, type CreatorSearchItem } from '@/app/actions/creator-lookup';

/**
 * 크리에이터 검색.
 * 코드(TOR-8K2M)뿐 아니라 크리에이터 이름·유튜브 채널명으로도 찾을 수 있다.
 * 결과가 1명이면 바로 후원 페이지로 이동하고, 여러 명이면 선택 목록을 보여준다.
 */
export function CreatorCodeForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [matches, setMatches] = React.useState<CreatorSearchItem[] | null>(null);
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMatches(null);
    startTransition(async () => {
      const res = await lookupCreatorCode(value);
      if (!res.ok) {
        setError(res.message ?? '조회에 실패했습니다.');
        return;
      }
      if (res.code) {
        router.push(`/c/${res.code}`);
        return;
      }
      if (res.matches) setMatches(res.matches);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="코드 · 채널명 · 닉네임"
          aria-label="크리에이터 코드 또는 이름 검색"
          autoFocus={autoFocus}
          maxLength={40}
          className="flex-1 text-center text-[16px] font-bold"
        />
        <Button type="submit" disabled={pending || value.trim().length < 2} className="shrink-0 px-5">
          {pending ? '검색중' : '검색'}
          <Search size={15} strokeWidth={1.9} />
        </Button>
      </div>
      <p className="text-center text-[11.5px] text-ink-400">
        크리에이터 코드(TOR-8K2M), 유튜브 채널명, 닉네임으로 검색할 수 있습니다.
      </p>

      {error ? <Notice tone="warning">{error}</Notice> : null}

      {matches ? (
        <div className="space-y-1.5">
          <p className="px-1 text-[12px] font-bold text-ink-500">검색 결과 {matches.length}명</p>
          {matches.map((m) => (
            <button
              key={m.code}
              type="button"
              onClick={() => router.push(`/c/${m.code}`)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-ink-100 bg-white px-3.5 py-3 text-left transition-colors hover:border-brand-300 hover:bg-brand-50"
            >
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-bold text-ink-900">{m.displayName}</span>
                <span className="block truncate text-[11.5px] text-ink-400">
                  {m.channelName ?? '채널명 미등록'} · <span className="font-mono">{m.code}</span>
                </span>
              </span>
              <ArrowRight size={15} strokeWidth={1.8} className="shrink-0 text-brand-700" />
            </button>
          ))}
        </div>
      ) : null}
    </form>
  );
}
