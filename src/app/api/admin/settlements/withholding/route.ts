import { requireAdmin } from '@/server/auth';
import { prisma } from '@/server/db';
import { decrypt } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 원천징수 지급명세서 산출 자료 다운로드.
 *
 * 지급 완료(PAID)된 기간별 내역을 CSV 로 내려준다. 국세청 사업소득 지급명세서 작성에 쓴다.
 * 주민등록번호는 파기 전에만 값이 있으며, 파기 후에는 마스킹만 남는다(회계 기록은 유지).
 *
 * ?from=YYYY-MM-DD&to=YYYY-MM-DD  (지급일 기준, 미지정 시 이번 달)
 */
function csvCell(v: string): string {
  const needsQuote = /[",\n]/.test(v) || /^[=+\-@]/.test(v);
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return needsQuote ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (admin.adminPermission === 'SUPPORT') {
    return new Response('재무/운영 권한이 필요합니다.', { status: 403 });
  }

  const url = new URL(req.url);
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600_000);
  const ym = kst.toISOString().slice(0, 7);
  const from = url.searchParams.get('from') || `${ym}-01`;
  const to = url.searchParams.get('to') || `${ym}-31`;
  const start = new Date(`${from}T00:00:00+09:00`);
  const end = new Date(`${to}T23:59:59+09:00`);

  const reqs = await prisma.settlementRequest.findMany({
    where: { status: 'PAID', paidAt: { gte: start, lte: end } },
    orderBy: { paidAt: 'asc' },
    select: {
      id: true, amount: true, withholding: true, payoutAmount: true,
      paidAt: true, residentEnc: true, residentMasked: true, residentPurgedAt: true,
      withholdingFiledAt: true,
      creator: { select: { displayName: true, code: true } },
    },
  });

  const header = [
    '지급일', '크리에이터', '코드', '지급총액(과세소득)', '원천징수세액(3.3%)', '실지급액',
    '주민등록번호', '주민번호상태', '원천징수신고',
  ];
  const lines = [header.join(',')];
  for (const r of reqs) {
    // 파기 전이면 원문을, 파기 후면 마스킹만 노출한다.
    const resident = r.residentEnc ? decrypt(r.residentEnc) : (r.residentMasked ?? '');
    const state = r.residentPurgedAt ? '파기됨' : r.residentEnc ? '보관중' : '미입력';
    lines.push(
      [
        r.paidAt ? new Date(r.paidAt.getTime() + 9 * 3600_000).toISOString().slice(0, 10) : '',
        r.creator.displayName,
        r.creator.code,
        r.amount.toString(),
        r.withholding.toString(),
        r.payoutAmount.toString(),
        resident,
        state,
        r.withholdingFiledAt ? '완료' : '대기',
      ]
        .map(csvCell)
        .join(','),
    );
  }

  const body = '﻿' + lines.join('\r\n') + '\r\n';
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="donaido-withholding-${from}_${to}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
