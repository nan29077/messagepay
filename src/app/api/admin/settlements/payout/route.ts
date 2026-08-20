import { requireAdmin } from '@/server/auth';
import { buildPayoutRows } from '@/server/services/settlement';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 지급대행(쿠콘) 대량이체 파일 다운로드.
 *
 * 승인(APPROVED) 상태의 선택 건을 CSV 로 내려준다.
 * 컬럼은 국내 펌뱅킹 대량이체 표준(은행코드·계좌번호·예금주·금액·적요)에 맞췄으며,
 * 쿠콘 연동규격서 수령 시 이 헤더/열 순서만 맞추면 그대로 업로드할 수 있다.
 *
 * ?ids=a,b,c  (승인 건 요청 ID 목록)
 */
function csvCell(v: string): string {
  // CSV 인젝션(=,+,-,@ 로 시작) 방지 + 콤마/따옴표 이스케이프
  const needsQuote = /[",\n]/.test(v) || /^[=+\-@]/.test(v);
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return needsQuote ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function GET(req: Request) {
  await requireAdmin();

  const url = new URL(req.url);
  const ids = (url.searchParams.get('ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    return new Response('선택된 정산 요청이 없습니다.', { status: 400 });
  }

  const rows = await buildPayoutRows(ids);

  const header = ['순번', '은행코드', '계좌번호', '예금주', '이체금액', '적요', '요청ID', '크리에이터', '코드'];
  const lines = [header.join(',')];
  rows.forEach((r, i) => {
    lines.push(
      [
        String(i + 1),
        r.bankCode,
        r.account,
        r.holder,
        r.amount.toString(),
        r.note,
        r.requestId,
        r.creatorName,
        r.creatorCode,
      ]
        .map(csvCell)
        .join(','),
    );
  });

  // Excel 이 UTF-8 한글을 바로 열도록 BOM 을 붙인다.
  const body = '﻿' + lines.join('\r\n') + '\r\n';
  const today = new URL(req.url).searchParams.get('day') ?? 'payout';
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="donaido-payout-${today}-${rows.length}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
