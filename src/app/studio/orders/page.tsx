import Link from 'next/link';
import { Badge, Card, EmptyState, Field, Input, Notice, SectionTitle, Select, StatTile, Textarea, cx } from '@/components/ui';
import { PageHeader } from '@/components/layout/console-shell';
import { ActionForm } from '@/components/studio/action-form';
import { updateShipmentAction } from '@/app/actions/studio';
import { requireMerchant } from '@/server/auth';
import { prisma } from '@/server/db';
import { decrypt } from '@/lib/crypto';
import { formatWon, formatNumber } from '@/lib/money';
import { formatKst } from '@/lib/datetime';
import { PAID_STATUSES } from '@/components/studio/shared';
import type { Prisma } from '@/generated/prisma/client';
import type { ShipmentStatus } from '@/generated/prisma/enums';

export const dynamic = 'force-dynamic';

/**
 * 실물 상품 주문·배송 관리.
 *
 * 결제가 완료된 실물 주문만 보여준다. 배송지 원문은 암호화 저장되어 있고,
 * 이 화면(가맹점 본인)과 최고관리자만 복호화해서 볼 수 있다.
 */

const PAGE_SIZE = 20;

const STATUS_LABEL: Record<ShipmentStatus, { text: string; tone: 'brand' | 'success' | 'warning' | 'neutral' | 'danger' }> = {
  PREPARING: { text: '배송 준비', tone: 'warning' },
  SHIPPED: { text: '발송 완료', tone: 'brand' },
  DELIVERED: { text: '배송 완료', tone: 'success' },
  CANCELED: { text: '배송 취소', tone: 'neutral' },
};

const FILTERS = [
  { key: '', label: '전체' },
  { key: 'PREPARING', label: '배송 준비' },
  { key: 'SHIPPED', label: '발송 완료' },
  { key: 'DELIVERED', label: '배송 완료' },
  { key: 'CANCELED', label: '취소' },
] as const;

export default async function StudioOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const { merchantId } = await requireMerchant();
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const status = FILTERS.some((f) => f.key === sp.status && f.key !== '') ? (sp.status as ShipmentStatus) : undefined;

  const where: Prisma.ChargeShipmentWhereInput = {
    merchantId,
    ...(status ? { status } : {}),
    // 결제가 완료된 주문만 처리 대상이다. 결제 전 단계는 아직 주문이 아니다.
    charge: { status: { in: PAID_STATUSES } },
  };

  const [total, rows, byStatus] = await Promise.all([
    prisma.chargeShipment.count({ where }),
    prisma.chargeShipment.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        charge: {
          select: {
            id: true, transactionNo: true, amount: true, shippingFee: true, quantity: true,
            optionText: true, paidAt: true, status: true, displayName: true,
            product: { select: { name: true, sku: true } },
          },
        },
      },
    }),
    prisma.chargeShipment.groupBy({
      by: ['status'],
      where: { merchantId, charge: { status: { in: PAID_STATUSES } } },
      _count: { _all: true },
    }),
  ]);

  const countOf = (s: ShipmentStatus) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ ...(status ? { status } : {}), ...extra });
    const s = p.toString();
    return s ? `?${s}` : '';
  };

  return (
    <>
      <PageHeader
        title="주문 · 배송"
        description="실물 상품 주문을 확인하고 송장을 등록합니다. 비실물 상품은 결제 내역에서 지급 처리합니다."
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatTile
          label="배송 준비"
          value={formatNumber(countOf('PREPARING'))}
          sub={countOf('PREPARING') > 0 ? '송장 등록 필요' : '없음'}
          tone={countOf('PREPARING') > 0 ? 'warning' : 'neutral'}
        />
        <StatTile label="발송 완료" value={formatNumber(countOf('SHIPPED'))} tone="brand" />
        <StatTile label="배송 완료" value={formatNumber(countOf('DELIVERED'))} tone="success" />
        <StatTile label="취소" value={formatNumber(countOf('CANCELED'))} />
      </div>

      <nav className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const active = (sp.status ?? '') === f.key;
          return (
            <Link
              key={f.key || 'all'}
              href={`/studio/orders${f.key ? `?status=${f.key}` : ''}`}
              className={cx(
                'rounded-full px-3.5 py-1.5 text-[12.5px] font-bold transition-colors',
                active ? 'bg-ink-900 text-brand-400' : 'bg-ink-50 text-ink-600 hover:bg-ink-100',
              )}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      <Notice tone="warning" title="배송지는 배송 목적으로만 사용해 주세요">
        받는 분 이름·연락처·주소는 암호화되어 저장되며 이 화면과 통합 관리자만 확인할 수 있습니다. 배송 외의 목적으로
        이용하거나 제3자에게 제공하면 개인정보보호법 위반입니다.
      </Notice>

      <div className="mt-4">
        <SectionTitle title="주문 목록" description={`전체 ${formatNumber(total)}건 (${page}/${lastPage} 페이지)`} />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="주문이 없습니다"
          description="실물 상품이 결제되면 여기에 배송지와 함께 표시됩니다."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((s) => {
            const st = STATUS_LABEL[s.status];
            const goods = s.charge.amount - s.charge.shippingFee;
            return (
              <Card key={s.id}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge tone={st.tone}>{st.text}</Badge>
                  <Link
                    href={`/studio/charges/${s.charge.id}`}
                    className="font-mono text-[12px] font-semibold text-brand-700 hover:underline"
                  >
                    {s.charge.transactionNo}
                  </Link>
                  <span className="text-[12px] text-ink-400">{formatKst(s.charge.paidAt, false)}</span>
                  {s.charge.status === 'REFUNDED' ? <Badge tone="danger">환불됨</Badge> : null}
                  {s.remote ? <Badge tone="warning">도서산간</Badge> : null}
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-xl bg-ink-50/70 px-3.5 py-2.5">
                    <p className="text-[13px] font-bold text-ink-900">
                      {s.charge.product?.name ?? '(보관된 상품)'}
                      <span className="ml-1 text-ink-500">× {s.charge.quantity}</span>
                    </p>
                    {s.charge.optionText ? (
                      <p className="mt-0.5 text-[12px] text-ink-600">{s.charge.optionText}</p>
                    ) : null}
                    {s.charge.product?.sku ? (
                      <p className="mt-0.5 font-mono text-[11px] text-ink-400">{s.charge.product.sku}</p>
                    ) : null}
                    <div className="mt-2 space-y-0.5 text-[12px]">
                      <div className="flex justify-between">
                        <span className="text-ink-500">상품 금액</span>
                        <span className="tabular-nums text-ink-800">{formatWon(goods)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-ink-500">배송비</span>
                        <span className="tabular-nums text-ink-800">
                          {s.charge.shippingFee === 0n ? '무료' : formatWon(s.charge.shippingFee)}
                        </span>
                      </div>
                      <div className="flex justify-between border-t border-ink-200 pt-1 font-bold">
                        <span className="text-ink-700">결제 금액</span>
                        <span className="tabular-nums text-ink-900">{formatWon(s.charge.amount)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-ink-100 px-3.5 py-2.5">
                    <p className="text-[11.5px] font-bold text-ink-400">배송지</p>
                    <p className="mt-1 text-[13px] font-semibold text-ink-900">
                      {decrypt(s.receiverEnc)}
                      <span className="ml-2 font-normal tabular-nums text-ink-600">{decrypt(s.phoneEnc)}</span>
                    </p>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-700">
                      ({s.zipCode}) {decrypt(s.addressEnc)}
                    </p>
                    {s.memo ? (
                      <p className="mt-1 rounded-lg bg-warning-50 px-2 py-1 text-[11.5px] text-ink-700">
                        요청: {s.memo}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 border-t border-ink-100 pt-3">
                  <ActionForm action={updateShipmentAction} submitLabel="배송 정보 저장" variant="secondary" size="sm">
                    <input type="hidden" name="chargeId" value={s.charge.id} />
                    <div className="grid gap-2.5 sm:grid-cols-3">
                      <Field label="배송 상태">
                        <Select name="status" defaultValue={s.status}>
                          <option value="PREPARING">배송 준비</option>
                          <option value="SHIPPED">발송 완료</option>
                          <option value="DELIVERED">배송 완료</option>
                          <option value="CANCELED">배송 취소</option>
                        </Select>
                      </Field>
                      <Field label="택배사">
                        <Input name="carrier" defaultValue={s.carrier ?? ''} maxLength={30} placeholder="CJ대한통운" />
                      </Field>
                      <Field label="송장번호">
                        <Input
                          name="trackingNo"
                          defaultValue={s.trackingNo ?? ''}
                          maxLength={40}
                          placeholder="123456789012"
                          className="tabular-nums"
                        />
                      </Field>
                    </div>
                    <Field label="메모 (선택)" hint="100자 이내. 이용자에게는 보이지 않습니다.">
                      <Textarea name="memo" rows={1} maxLength={100} defaultValue={s.memo ?? ''} />
                    </Field>
                  </ActionForm>
                  {s.shippedAt ? (
                    <p className="mt-1.5 text-[11.5px] text-ink-400">
                      발송 {formatKst(s.shippedAt, false)}
                      {s.deliveredAt ? ` · 배송 완료 ${formatKst(s.deliveredAt, false)}` : ''}
                    </p>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {lastPage > 1 ? (
        <nav className="mt-4 flex items-center justify-between gap-3">
          {page > 1 ? (
            <Link
              href={`/studio/orders${qs({ page: String(page - 1) })}`}
              className="rounded-lg border border-ink-200 px-3 py-1.5 text-[12.5px] font-bold text-ink-700 hover:bg-ink-50"
            >
              이전
            </Link>
          ) : (
            <span />
          )}
          <span className="text-[12.5px] font-semibold tabular-nums text-ink-500">
            {page} / {lastPage}
          </span>
          {page < lastPage ? (
            <Link
              href={`/studio/orders${qs({ page: String(page + 1) })}`}
              className="rounded-lg border border-ink-200 px-3 py-1.5 text-[12.5px] font-bold text-ink-700 hover:bg-ink-50"
            >
              다음
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </>
  );
}
