'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { Button, Input, Notice } from '@/components/ui';
import { lookupCreatorCode } from '@/app/actions/creator-lookup';

/**
 * 크리에이터 코드 입력.
 * 토네이도는 전체 크리에이터 목록을 공개하지 않으므로 이 입력이 유일한 진입점이다.
 */
export function CreatorCodeForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await lookupCreatorCode(value);
      if (!res.ok) {
        setError(res.message ?? '조회에 실패했습니다.');
        return;
      }
      router.push(`/c/${res.code}`);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          placeholder="TOR-8K2M"
          aria-label="크리에이터 코드"
          autoFocus={autoFocus}
          maxLength={12}
          className="flex-1 text-center text-[18px] font-bold tracking-[0.12em]"
        />
        <Button type="submit" disabled={pending || value.length < 4} className="shrink-0 px-5">
          {pending ? '조회중' : '이동'}
          <ArrowRight size={16} strokeWidth={1.8} />
        </Button>
      </div>
      {error ? <Notice tone="warning">{error}</Notice> : null}
    </form>
  );
}
