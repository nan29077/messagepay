'use client';

import * as React from 'react';
import { CircleCheck, CircleX, Clock, ShieldCheck } from 'lucide-react';
import { Button, Card, DataRow, Notice } from '@/components/ui';
import { confirmDonationAction, type ConfirmActionResult } from '@/app/actions/confirm';

/**
 * 문자후원 결제 확인 화면.
 * - 남은 유효시간을 카운트다운으로 표시한다.
 * - 확인 버튼은 1회만 눌리며, 서버에서도 1회용 보안링크로 중복 결제를 막는다.
 */

export function ConfirmPanel({
  token,
  creatorName,
  amountText,
  buttonText,
  message,
  expiresAtIso,
}: {
  token: string;
  creatorName: string;
  amountText: string;
  buttonText: string;
  message: string;
  expiresAtIso: string;
}) {
  const expiresAt = React.useMemo(() => new Date(expiresAtIso).getTime(), [expiresAtIso]);
  const [remainMs, setRemainMs] = React.useState(() => Math.max(0, expiresAt - Date.now()));
  const [pending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<ConfirmActionResult | null>(null);
  const submitted = React.useRef(false);

  React.useEffect(() => {
    const id = setInterval(() => setRemainMs(Math.max(0, expiresAt - Date.now())), 500);
    return () => clearInterval(id);
  }, [expiresAt]);

  const expired = remainMs <= 0;
  const mm = String(Math.floor(remainMs / 60000)).padStart(2, '0');
  const ss = String(Math.floor((remainMs % 60000) / 1000)).padStart(2, '0');

  function submit() {
    if (submitted.current || pending || expired) return;
    submitted.current = true;
    startTransition(async () => {
      const res = await confirmDonationAction(token);
      setResult(res);
    });
  }

  if (result?.ok) {
    return (
      <Card>
        <div className="flex items-center gap-2 text-success-500">
          <CircleCheck size={20} strokeWidth={1.7} />
          <p className="text-[16px] font-extrabold text-ink-900">후원이 완료되었습니다</p>
        </div>
        <div className="mt-3">
          <DataRow label="크리에이터" value={creatorName} />
          <DataRow label="후원금" value={amountText} />
          {result.transactionNo ? <DataRow label="거래번호" value={result.transactionNo} /> : null}
        </div>
        <div className="mt-3">
          <Notice tone="brand" title="방송 노출 안내">
            결제가 완료된 후원만 방송 오버레이와 유튜브 라이브 채팅에 표시됩니다. 방송이 진행 중이 아니거나 채팅이
            제한된 경우 노출이 지연될 수 있습니다.
          </Notice>
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-ink-400">
          결제 결과는 문자로도 안내됩니다. 후원 취소·환불 문의는 고객센터로 접수해 주세요.
        </p>
      </Card>
    );
  }

  if (result && !result.ok) {
    return (
      <Card>
        <div className="flex items-center gap-2 text-danger-500">
          <CircleX size={20} strokeWidth={1.7} />
          <p className="text-[16px] font-extrabold text-ink-900">후원이 완료되지 않았습니다</p>
        </div>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-700">{result.message}</p>
        <div className="mt-3">
          <Notice tone="warning" title="결제되지 않았습니다">
            이 요청으로는 계좌에서 출금이 발생하지 않았으며, 메시지도 방송에 표시되지 않습니다. 다시 후원하시려면
            크리에이터 번호로 문자를 새로 보내주세요.
          </Notice>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-semibold text-ink-500">후원 확인</p>
          <span className="inline-flex items-center gap-1 rounded-md bg-ink-50 px-2 py-1 text-[12px] font-bold tabular-nums text-ink-700">
            <Clock size={14} strokeWidth={1.7} />
            {expired ? '00:00' : `${mm}:${ss}`}
          </span>
        </div>
        <p className="mt-2 text-[22px] font-extrabold tracking-tight text-ink-900">{amountText}</p>
        <div className="mt-3">
          <DataRow label="크리에이터" value={creatorName} />
          <DataRow label="메시지" value={message || '(내용 없음)'} />
        </div>
      </Card>

      {expired ? (
        <Notice tone="warning" title="확인 시간이 지났습니다">
          확인 시간이 지나 후원이 자동 취소되었습니다. 결제는 진행되지 않았습니다. 다시 후원하시려면 크리에이터
          번호로 문자를 새로 보내주세요.
        </Notice>
      ) : (
        <Notice tone="brand" title="확인 시 즉시 출금됩니다">
          아래 버튼을 누르면 등록한 계좌에서 후원금이 출금됩니다. 확인하지 않으면 결제는 진행되지 않습니다.
        </Notice>
      )}

      <Button size="lg" onClick={submit} disabled={expired || pending}>
        <ShieldCheck size={18} strokeWidth={1.7} />
        {pending ? '결제 처리 중' : buttonText}
      </Button>
    </div>
  );
}
