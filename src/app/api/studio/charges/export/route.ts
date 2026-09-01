import { requireMerchant } from '@/server/auth';
import { prisma } from '@/server/db';
import { formatKst } from '@/lib/datetime';
import { chargeStatusLabel, deliveryStatusLabel } from '@/lib/labels';
import { PAID_STATUSES } from '@/components/studio/shared';
import type { ChargeStatus, Prisma } from '@/generated/prisma/client';

/**
 * 가맹점 결제 내역 CSV.
 *
 * 가맹점이 자기 시스템에 포인트를 일괄 반영할 때 쓴다.
 * 화면의 필터(기간·상태·지급 상태·거래번호)를 그대로 받아 같은 결과를 내려준다.
 *
 * 개인정보는 마스킹된 값만 담는다. 원문 전화번호는 어떤 경우에도 내보내지 않는다.
 */

export const dynamic = 'force-dynamic';

/** 한 번에 내려받을 수 있는 최대 건수. 그 이상은 기간을 좁혀서 받는다. */
const MAX_ROWS = 5000;

function csvCell(v: string | null | undefined): string {
  const s = (v ?? '').replace(/\r?\n/g, ' ');
  // 엑셀에서 수식으로 해석되는 문자로 시작하면 앞에 작은따옴표를 붙여 무력화한다.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(req: Request) {
  const { merchantId } = await requireMerchant();
  const url = new URL(req.url);

  const period = url.searchParams.get('period') || '30d';
  const status = url.searchParams.get('status') || '';
  const point = url.searchParams.get('point') || '';
  const q = (url.searchParams.get('q') || '').trim();

  const where: Prisma.ChargeWhereInput = { merchantId };
  const now = Date.now();
  if (period === 'today') where.receivedAt = { gte: new Date(new Date().setHours(0, 0, 0, 0)) };
  else if (period === '7d') where.receivedAt = { gte: new Date(now - 7 * 86_400_000) };
  else if (period === '30d') where.receivedAt = { gte: new Date(now - 30 * 86_400_000) };

  if (status && status in chargeStatusLabel) where.status = status as ChargeStatus;
  if (q) where.transactionNo = { contains: q, mode: 'insensitive' };
  if (point === 'pending') where.pointStatus = 'PENDING';
  if (point === 'given') where.pointStatus = 'SENT';
  if (point === 'held') where.pointStatus = 'FAILED';

  const rows = await prisma.charge.findMany({
    where,
    orderBy: { receivedAt: 'desc' },
    take: MAX_ROWS,
    select: {
      transactionNo: true,
      receivedAt: true,
      paidAt: true,
      amount: true,
      status: true,
      displayName: true,
      message: true,
      pointStatus: true,
      pointGivenAt: true,
      pointNote: true,
      payer: { select: { phoneMasked: true } },
    },
  });

  const header = [
    '거래번호',
    '수신시각',
    '결제시각',
    '금액',
    '결제상태',
    '표시이름',
    '연락처(마스킹)',
    '메모',
    '포인트지급',
    '지급시각',
    '지급메모',
    '지급대상여부',
  ];

  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.transactionNo),
        csvCell(formatKst(r.receivedAt)),
        csvCell(r.paidAt ? formatKst(r.paidAt) : ''),
        csvCell(r.amount.toString()),
        csvCell(chargeStatusLabel[r.status].text),
        csvCell(r.displayName),
        csvCell(r.payer?.phoneMasked ?? ''),
        csvCell(r.message),
        csvCell(deliveryStatusLabel[r.pointStatus].text),
        csvCell(r.pointGivenAt ? formatKst(r.pointGivenAt) : ''),
        csvCell(r.pointNote ?? ''),
        csvCell(PAID_STATUSES.includes(r.status) ? 'Y' : 'N'),
      ].join(','),
    );
  }

  // 엑셀이 UTF-8 로 열도록 BOM 을 붙인다.
  const body = `﻿${lines.join('\r\n')}\r\n`;
  const today = formatKst(new Date(), false).replace(/[^0-9]/g, '').slice(0, 8);

  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="munjapay-charges-${today}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
