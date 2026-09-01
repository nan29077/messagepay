import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Badge, Card, CardTitle, DataRow, Field, Input, Notice, SectionTitle, Select, StatTile, Textarea, cx,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/console-shell';
import { ActionForm, InlineActionForm } from '@/components/studio/action-form';
import { ImageUploadField } from '@/components/studio/image-upload-field';
import {
  createChargeProductAction,
  updateChargeProductAction,
  archiveChargeProductAction,
  adjustProductStockAction,
  saveShippingPolicyAction,
} from '@/app/actions/studio';
import { requireMerchant } from '@/server/auth';
import { prisma } from '@/server/db';
import { resolvePolicy } from '@/server/services/limits';
import {
  digitalTypeLabel, giveText, optionsToLines, quoteShipping, shippingPolicyOf, stockText,
} from '@/server/services/products';
import { formatWon, formatNumber } from '@/lib/money';

export const dynamic = 'force-dynamic';

/**
 * 상품 설정.
 *
 * 비실물(포인트·상품권·이용권)과 실물(배송비·조건부무료·재고·옵션)을 나눠서 등록한다.
 * 여기서 만든 상품이 MO 안내 문자의 결제 링크에서 그대로 선택지로 뜬다.
 */

const TABS = [
  { key: 'digital', label: '비실물 상품' },
  { key: 'physical', label: '실물 상품' },
  { key: 'shipping', label: '배송 정책' },
] as const;

type Tab = (typeof TABS)[number]['key'];

export default async function StudioProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { merchantId } = await requireMerchant();
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : 'digital';

  const [merchant, products, policy, shippingRow, soldByProduct] = await Promise.all([
    prisma.merchantProfile.findUnique({
      where: { id: merchantId },
      select: { id: true, displayName: true, allowCustomAmount: true, minAmount: true, maxAmount: true },
    }),
    prisma.chargeProduct.findMany({
      where: { merchantId, archivedAt: null },
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { amount: 'asc' }],
    }),
    resolvePolicy(merchantId, null),
    prisma.merchantShippingPolicy.findUnique({ where: { merchantId } }),
    // 상품별 판매 건수(보관 여부 판단에 쓰인다)
    prisma.charge.groupBy({
      by: ['productId'],
      where: { merchantId, productId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  if (!merchant) notFound();

  const shipping = shippingPolicyOf(shippingRow);
  const effMin = merchant.minAmount > policy.minAmount ? merchant.minAmount : policy.minAmount;
  const effMax = merchant.maxAmount < policy.maxAmount ? merchant.maxAmount : policy.maxAmount;

  const digital = products.filter((p) => p.kind === 'DIGITAL');
  const physical = products.filter((p) => p.kind === 'PHYSICAL');
  const soldOf = (id: string) => soldByProduct.find((s) => s.productId === id)?._count._all ?? 0;

  const lowStock = physical.filter(
    (p) => p.stock !== null && p.stockAlert !== null && p.stock <= p.stockAlert,
  );
  const soldOut = physical.filter((p) => p.stock !== null && p.stock <= 0);

  /** 실물 상품 1개 주문 시 이용자가 실제로 낼 금액 (배송정책까지 반영) */
  const previewOf = (p: (typeof physical)[number]) =>
    quoteShipping(
      { kind: p.kind, amount: p.amount, shippingFee: p.shippingFee, freeShipOver: p.freeShipOver, freeShipping: p.freeShipping },
      1,
      shipping,
    );

  return (
    <>
      <PageHeader
        title="상품 설정"
        description="이용자가 문자를 보내면 여기에 등록한 상품 중에서 고르고 결제합니다."
      />

      <nav
        aria-label="상품 설정 메뉴"
        className="mb-5 grid grid-cols-3 overflow-hidden rounded-2xl border border-ink-100 bg-white p-1 shadow-[0_8px_24px_rgba(23,22,26,0.05)]"
      >
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/studio/products?tab=${t.key}`}
            aria-current={tab === t.key ? 'page' : undefined}
            className={cx(
              'flex min-h-11 items-center justify-center rounded-xl px-1 text-center text-[12px] font-bold transition-colors sm:px-3 sm:text-[13px]',
              tab === t.key ? 'bg-brand-400 text-ink-900 shadow-sm' : 'text-ink-400 hover:bg-ink-50 hover:text-ink-800',
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="mb-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatTile label="비실물 상품" value={formatNumber(digital.length)} sub={`사용 중 ${digital.filter((p) => p.active).length}개`} tone="brand" />
        <StatTile label="실물 상품" value={formatNumber(physical.length)} sub={`사용 중 ${physical.filter((p) => p.active).length}개`} />
        <StatTile
          label="재고 부족"
          value={formatNumber(lowStock.length)}
          sub={lowStock.length > 0 ? lowStock.map((p) => p.name).slice(0, 2).join(', ') : '없음'}
          tone={lowStock.length > 0 ? 'warning' : 'neutral'}
        />
        <StatTile
          label="품절"
          value={formatNumber(soldOut.length)}
          sub={soldOut.length > 0 ? '선택 화면에서 품절 표시' : '없음'}
          tone={soldOut.length > 0 ? 'danger' : 'neutral'}
        />
      </div>

      <div className="space-y-5">
        {/* ─────────────────────── 비실물 상품 ─────────────────────── */}
        {tab === 'digital' ? (
          <>
            <section>
              <SectionTitle
                title="비실물 상품"
                description="포인트 · 상품권 · 이용권처럼 배송이 없는 상품입니다. 지급은 가맹점이 직접 처리합니다."
              />
              <Notice tone="neutral" title="포인트는 가맹점이 발행합니다">
                문자페이는 결제와 정산만 대행하고, 포인트·상품권·이용권의 발행과 지급은 가맹점이 합니다. 결제 완료
                건은 <Link href="/studio/charges" className="font-bold text-brand-700">결제 내역</Link> 에서 지급 처리하거나
                연동 API 로 자동 적립할 수 있습니다.
              </Notice>
            </section>

            {digital.length === 0 ? (
              <Notice tone="warning">
                등록된 비실물 상품이 없습니다. 상품이 하나도 없고 직접 입력도 꺼져 있으면 이용자가 결제를 진행할 수
                없습니다.
              </Notice>
            ) : (
              <div className="space-y-3">
                {digital.map((p) => (
                  <Card key={p.id}>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <CardTitle>{p.name}</CardTitle>
                      <Badge tone="brand">{digitalTypeLabel[p.digitalType ?? 'POINT']}</Badge>
                      {p.active ? <Badge tone="success">사용 중</Badge> : <Badge tone="neutral">숨김</Badge>}
                      <span className="ml-auto text-[11.5px] text-ink-400">판매 {formatNumber(soldOf(p.id))}건</span>
                    </div>

                    <ActionForm action={updateChargeProductAction} submitLabel="저장" variant="secondary" size="sm">
                      <input type="hidden" name="productId" value={p.id} />
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        <Field label="상품 이름">
                          <Input name="name" defaultValue={p.name} maxLength={40} />
                        </Field>
                        <Field label="유형">
                          <Select name="digitalType" defaultValue={p.digitalType ?? 'POINT'}>
                            <option value="POINT">포인트</option>
                            <option value="VOUCHER">상품권</option>
                            <option value="PASS">이용권</option>
                          </Select>
                        </Field>
                        <Field label="판매 금액 (원)" hint={`${formatWon(effMin)} ~ ${formatWon(effMax)}`}>
                          <Input name="amount" inputMode="numeric" defaultValue={p.amount.toString()} className="tabular-nums" />
                        </Field>
                        <Field label="지급 수량" hint="비우면 포인트는 금액과 1:1. 보너스를 주려면 크게 적으세요.">
                          <Input
                            name="giveAmount"
                            inputMode="numeric"
                            defaultValue={p.giveAmount != null ? p.giveAmount.toString() : ''}
                            className="tabular-nums"
                          />
                        </Field>
                        <Field label="지급 단위" hint="포인트 · 매 · 개월 등">
                          <Input name="giveUnit" defaultValue={p.giveUnit ?? ''} maxLength={10} placeholder="포인트" />
                        </Field>
                        <Field label="유효기간 (일)" hint="이용권은 필수. 비우면 무기한.">
                          <Input
                            name="validDays"
                            inputMode="numeric"
                            defaultValue={p.validDays != null ? String(p.validDays) : ''}
                            className="tabular-nums"
                          />
                        </Field>
                      </div>
                      <Field label="상품 설명" hint="결제 화면에 함께 보여집니다. 300자 이내.">
                        <Textarea name="description" rows={2} maxLength={300} defaultValue={p.description ?? ''} />
                      </Field>
                      <div className="grid gap-2.5 sm:grid-cols-[0.7fr_auto]">
                        <Field label="노출 순서">
                          <Input name="sortOrder" inputMode="numeric" defaultValue={String(p.sortOrder)} className="tabular-nums" />
                        </Field>
                        <label className="flex items-end gap-2 pb-2 text-[12.5px] font-semibold text-ink-700">
                          <input type="checkbox" name="active" defaultChecked={p.active} className="h-4 w-4" />
                          결제 화면에 노출
                        </label>
                      </div>
                    </ActionForm>

                    <div className="mt-2 flex items-center justify-between gap-2 border-t border-ink-100 pt-2">
                      <p className="text-[11.5px] text-ink-400">
                        결제 시 안내: {giveText(p) ?? `${formatWon(p.amount)} 결제`}
                      </p>
                      <InlineActionForm
                        action={archiveChargeProductAction}
                        submitLabel="보관"
                        variant="ghost"
                        confirmMessage={`${p.name} 상품을 보관합니다. 선택 화면에서 사라지며, 지난 결제 내역은 그대로 남습니다.`}
                        fields={{ productId: p.id }}
                      />
                    </div>
                  </Card>
                ))}
              </div>
            )}

            <Card>
              <CardTitle>비실물 상품 추가</CardTitle>
              <p className="mb-3 mt-1 text-[12.5px] leading-relaxed text-ink-500">
                포인트는 금액과 1:1 지급이 기본입니다. 보너스를 주려면 지급 수량을 금액보다 크게 적으세요.
              </p>
              <ActionForm action={createChargeProductAction} submitLabel="상품 추가">
                <input type="hidden" name="kind" value="DIGITAL" />
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <Field label="상품 이름" hint="예: 10,000 포인트" required>
                    <Input name="name" maxLength={40} placeholder="10,000 포인트" />
                  </Field>
                  <Field label="유형" required>
                    <Select name="digitalType" defaultValue="POINT">
                      <option value="POINT">포인트</option>
                      <option value="VOUCHER">상품권</option>
                      <option value="PASS">이용권</option>
                    </Select>
                  </Field>
                  <Field label="판매 금액 (원)" hint={`${formatWon(effMin)} ~ ${formatWon(effMax)}`} required>
                    <Input name="amount" inputMode="numeric" placeholder="10000" className="tabular-nums" />
                  </Field>
                  <Field label="지급 수량" hint="비우면 금액과 1:1">
                    <Input name="giveAmount" inputMode="numeric" placeholder="11000" className="tabular-nums" />
                  </Field>
                  <Field label="지급 단위">
                    <Input name="giveUnit" maxLength={10} placeholder="포인트" />
                  </Field>
                  <Field label="유효기간 (일)" hint="이용권은 필수">
                    <Input name="validDays" inputMode="numeric" placeholder="30" className="tabular-nums" />
                  </Field>
                </div>
                <Field label="상품 설명" hint="300자 이내">
                  <Textarea name="description" rows={2} maxLength={300} placeholder="결제 화면에 보여줄 설명" />
                </Field>
              </ActionForm>
            </Card>
          </>
        ) : null}

        {/* ─────────────────────── 실물 상품 ─────────────────────── */}
        {tab === 'physical' ? (
          <>
            <section>
              <SectionTitle
                title="실물 상품"
                description="배송이 필요한 상품입니다. 배송비·조건부 무료·재고·옵션을 상품별로 지정할 수 있습니다."
              />
              <Notice tone="warning" title="결제 한도를 넘지 않게 값을 잡아 주세요">
                문자결제 1건 한도는 {formatWon(effMax)} 입니다. <strong>상품 가격 + 배송비</strong>가 이 한도를 넘으면
                이용자가 결제할 수 없습니다. 여러 개를 살 수 있게 하려면 1회 주문 최대 수량도 함께 확인하세요.
                <br />
                처음 이용하는 분은 <strong>첫날 한도 {formatWon(policy.newPayerFirstDayLimit)}</strong> 이 따로 적용됩니다.
                고가 상품은 첫 주문에서 막힐 수 있으니, 한도 조정이 필요하면 고객센터로 문의해 주세요.
              </Notice>
            </section>

            {physical.length === 0 ? (
              <Notice tone="neutral">등록된 실물 상품이 없습니다. 아래에서 추가해 주세요.</Notice>
            ) : (
              <div className="space-y-3">
                {physical.map((p) => {
                  const q = previewOf(p);
                  const stock = stockText(p);
                  return (
                    <Card key={p.id}>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <CardTitle>{p.name}</CardTitle>
                        {p.active ? <Badge tone="success">사용 중</Badge> : <Badge tone="neutral">숨김</Badge>}
                        {stock ? (
                          <Badge tone={p.stock !== null && p.stock <= 0 ? 'danger' : p.stockAlert !== null && p.stock !== null && p.stock <= p.stockAlert ? 'warning' : 'neutral'}>
                            {stock}
                          </Badge>
                        ) : (
                          <Badge tone="neutral">재고 무제한</Badge>
                        )}
                        <span className="ml-auto text-[11.5px] text-ink-400">판매 {formatNumber(soldOf(p.id))}건</span>
                      </div>

                      <div className="mb-3 rounded-xl bg-ink-50/70 px-3 py-2">
                        <p className="text-[12px] font-bold text-ink-700">
                          1개 주문 시 결제 금액 {formatWon(q.total)}
                          <span className="ml-1 font-semibold text-ink-400">
                            (상품 {formatWon(q.goods)} + 배송비 {formatWon(q.fee)}
                            {q.freeReason ? ` · ${q.freeReason}` : ''})
                          </span>
                        </p>
                        {q.freeShortfall !== null && q.freeShortfall > 0n ? (
                          <p className="mt-0.5 text-[11.5px] text-ink-400">
                            {formatWon(q.freeShortfall)} 더 담으면 배송비 무료
                          </p>
                        ) : null}
                        {q.total > effMax ? (
                          <p className="mt-0.5 text-[11.5px] font-bold text-danger-500">
                            결제 한도({formatWon(effMax)})를 넘어 이용자가 결제할 수 없습니다.
                          </p>
                        ) : null}
                      </div>

                      <ActionForm action={updateChargeProductAction} submitLabel="저장" variant="secondary" size="sm">
                        <input type="hidden" name="productId" value={p.id} />
                        <div className="grid gap-2.5 sm:grid-cols-2">
                          <Field label="상품 이름">
                            <Input name="name" defaultValue={p.name} maxLength={40} />
                          </Field>
                          <Field label="상품 코드 (SKU)" hint="가맹점 내부 관리용">
                            <Input name="sku" defaultValue={p.sku ?? ''} maxLength={40} />
                          </Field>
                          <Field label="판매 금액 (원)" hint="배송비 제외한 상품 1개 가격">
                            <Input name="amount" inputMode="numeric" defaultValue={p.amount.toString()} className="tabular-nums" />
                          </Field>
                          <Field label="재고" hint="비우면 무제한. 결제 승인 시 차감됩니다.">
                            <Input
                              name="stock"
                              inputMode="numeric"
                              defaultValue={p.stock != null ? String(p.stock) : ''}
                              className="tabular-nums"
                            />
                          </Field>
                          <Field label="재고 경고 기준" hint="이 수량 이하면 화면에 경고">
                            <Input
                              name="stockAlert"
                              inputMode="numeric"
                              defaultValue={p.stockAlert != null ? String(p.stockAlert) : ''}
                              className="tabular-nums"
                            />
                          </Field>
                          <Field label="1회 주문 최대 수량" hint="비우면 결제 한도까지">
                            <Input
                              name="maxPerOrder"
                              inputMode="numeric"
                              defaultValue={p.maxPerOrder != null ? String(p.maxPerOrder) : ''}
                              className="tabular-nums"
                            />
                          </Field>
                          <Field label="배송비 (원)" hint="비우면 기본 배송정책 사용">
                            <Input
                              name="shippingFee"
                              inputMode="numeric"
                              defaultValue={p.shippingFee != null ? p.shippingFee.toString() : ''}
                              className="tabular-nums"
                            />
                          </Field>
                          <Field label="조건부 무료 기준 (원)" hint="비우면 기본 배송정책 사용">
                            <Input
                              name="freeShipOver"
                              inputMode="numeric"
                              defaultValue={p.freeShipOver != null ? p.freeShipOver.toString() : ''}
                              className="tabular-nums"
                            />
                          </Field>
                        </div>

                        <Field label="옵션" hint="한 줄에 하나씩 `이름: 값1, 값2` 형식. 최대 3종.">
                          <Textarea
                            name="options"
                            rows={3}
                            defaultValue={optionsToLines(p.options)}
                            placeholder={'사이즈: S, M, L\n색상: 블랙, 화이트'}
                          />
                        </Field>

                        <Field label="상품 설명" hint="300자 이내">
                          <Textarea name="description" rows={2} maxLength={300} defaultValue={p.description ?? ''} />
                        </Field>

                        <div className="grid gap-2.5 sm:grid-cols-[0.7fr_auto_auto]">
                          <Field label="노출 순서">
                            <Input name="sortOrder" inputMode="numeric" defaultValue={String(p.sortOrder)} className="tabular-nums" />
                          </Field>
                          <label className="flex items-end gap-2 pb-2 text-[12.5px] font-semibold text-ink-700">
                            <input type="checkbox" name="freeShipping" defaultChecked={p.freeShipping} className="h-4 w-4" />
                            항상 무료배송
                          </label>
                          <label className="flex items-end gap-2 pb-2 text-[12.5px] font-semibold text-ink-700">
                            <input type="checkbox" name="active" defaultChecked={p.active} className="h-4 w-4" />
                            결제 화면에 노출
                          </label>
                        </div>
                      </ActionForm>

                      <div className="mt-2 flex flex-wrap items-end justify-between gap-2 border-t border-ink-100 pt-2">
                        <ActionForm action={adjustProductStockAction} submitLabel="재고 맞추기" variant="ghost" size="sm">
                          <input type="hidden" name="productId" value={p.id} />
                          <Field label="재고 즉시 조정" hint="비우고 저장하면 무제한">
                            <Input
                              name="stock"
                              inputMode="numeric"
                              defaultValue={p.stock != null ? String(p.stock) : ''}
                              className="w-28 tabular-nums"
                            />
                          </Field>
                        </ActionForm>
                        <InlineActionForm
                          action={archiveChargeProductAction}
                          submitLabel="보관"
                          variant="ghost"
                          confirmMessage={`${p.name} 상품을 보관합니다. 선택 화면에서 사라지며, 지난 주문 내역은 그대로 남습니다.`}
                          fields={{ productId: p.id }}
                        />
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}

            <Card>
              <CardTitle>실물 상품 추가</CardTitle>
              <p className="mb-3 mt-1 text-[12.5px] leading-relaxed text-ink-500">
                배송비와 조건부 무료를 비워두면 아래 &ldquo;배송 정책&rdquo; 탭의 기본값이 적용됩니다.
              </p>
              <ActionForm action={createChargeProductAction} submitLabel="상품 추가">
                <input type="hidden" name="kind" value="PHYSICAL" />
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <Field label="상품 이름" required>
                    <Input name="name" maxLength={40} placeholder="기념 굿즈 티셔츠" />
                  </Field>
                  <Field label="상품 코드 (SKU)">
                    <Input name="sku" maxLength={40} placeholder="TS-001" />
                  </Field>
                  <Field label="판매 금액 (원)" hint="배송비 제외" required>
                    <Input name="amount" inputMode="numeric" placeholder="19000" className="tabular-nums" />
                  </Field>
                  <Field label="재고" hint="비우면 무제한">
                    <Input name="stock" inputMode="numeric" placeholder="50" className="tabular-nums" />
                  </Field>
                  <Field label="재고 경고 기준">
                    <Input name="stockAlert" inputMode="numeric" placeholder="5" className="tabular-nums" />
                  </Field>
                  <Field label="1회 주문 최대 수량">
                    <Input name="maxPerOrder" inputMode="numeric" placeholder="2" className="tabular-nums" />
                  </Field>
                  <Field label="배송비 (원)" hint="비우면 기본 배송정책">
                    <Input name="shippingFee" inputMode="numeric" placeholder="3000" className="tabular-nums" />
                  </Field>
                  <Field label="조건부 무료 기준 (원)" hint="비우면 기본 배송정책">
                    <Input name="freeShipOver" inputMode="numeric" placeholder="50000" className="tabular-nums" />
                  </Field>
                </div>
                <Field label="옵션" hint="한 줄에 하나씩 `이름: 값1, 값2` 형식. 최대 3종.">
                  <Textarea name="options" rows={3} placeholder={'사이즈: S, M, L\n색상: 블랙, 화이트'} />
                </Field>
                <Field label="상품 설명" hint="300자 이내">
                  <Textarea name="description" rows={2} maxLength={300} />
                </Field>
                <ImageUploadField name="imageUrl" label="상품 이미지 (선택)" aspect="wide" hint="결제 화면에 함께 보여집니다." />
                <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-700">
                  <input type="checkbox" name="freeShipping" className="h-4 w-4" />
                  항상 무료배송
                </label>
              </ActionForm>
            </Card>
          </>
        ) : null}

        {/* ─────────────────────── 배송 정책 ─────────────────────── */}
        {tab === 'shipping' ? (
          <>
            <section>
              <SectionTitle
                title="기본 배송 정책"
                description="상품별로 배송비를 지정하지 않았을 때 적용되는 값입니다."
              />
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardTitle>배송비 설정</CardTitle>
                <div className="mt-3">
                  <ActionForm action={saveShippingPolicyAction} submitLabel="배송 정책 저장">
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      <Field label="기본 배송비 (원)" required>
                        <Input
                          name="baseFee"
                          inputMode="numeric"
                          defaultValue={shipping.baseFee.toString()}
                          className="tabular-nums"
                        />
                      </Field>
                      <Field label="조건부 무료 기준 (원)" hint="이 금액 이상이면 배송비 무료. 비우면 조건부 무료 없음.">
                        <Input
                          name="freeOver"
                          inputMode="numeric"
                          defaultValue={shipping.freeOver != null ? shipping.freeOver.toString() : ''}
                          className="tabular-nums"
                        />
                      </Field>
                      <Field label="도서산간 추가 배송비 (원)" hint="제주·도서 지역 주문에 더해집니다.">
                        <Input
                          name="remoteFee"
                          inputMode="numeric"
                          defaultValue={shipping.remoteFee.toString()}
                          className="tabular-nums"
                        />
                      </Field>
                      <Field label="택배사" hint="배송 안내에 표시됩니다.">
                        <Input name="carrier" defaultValue={shipping.carrier ?? ''} maxLength={30} placeholder="CJ대한통운" />
                      </Field>
                    </div>
                    <Field label="배송 안내 문구" hint="결제 화면과 주문 안내에 그대로 보여집니다. 300자 이내.">
                      <Textarea
                        name="guide"
                        rows={3}
                        maxLength={300}
                        defaultValue={shipping.guide ?? ''}
                        placeholder="영업일 기준 2~3일 내 발송됩니다. 주말·공휴일은 발송이 어렵습니다."
                      />
                    </Field>
                  </ActionForm>
                </div>
              </Card>

              <Card>
                <CardTitle>지금 적용되는 값</CardTitle>
                <div className="mt-3">
                  <DataRow label="기본 배송비" value={formatWon(shipping.baseFee)} />
                  <DataRow
                    label="조건부 무료"
                    value={shipping.freeOver != null ? `${formatWon(shipping.freeOver)} 이상 무료` : '없음'}
                  />
                  <DataRow label="도서산간 추가" value={shipping.remoteFee > 0n ? formatWon(shipping.remoteFee) : '없음'} />
                  <DataRow label="택배사" value={shipping.carrier ?? '미지정'} />
                </div>

                <div className="mt-3">
                  <Notice tone="neutral" title="상품별 설정이 우선입니다">
                    상품에 배송비나 조건부 무료 기준을 직접 넣으면 그 값이 먼저 적용됩니다. &ldquo;항상 무료배송&rdquo;을 켠
                    상품은 두 값 모두 무시하고 0원입니다. 도서산간 추가 배송비는 무료배송이어도 붙습니다(실제 택배 요금
                    구조와 같습니다).
                  </Notice>
                </div>

                {physical.length > 0 ? (
                  <div className="mt-4">
                    <p className="mb-2 text-[12.5px] font-bold text-ink-700">상품별 적용 결과 (1개 주문 기준)</p>
                    <div className="space-y-1.5">
                      {physical.map((p) => {
                        const q = previewOf(p);
                        return (
                          <div key={p.id} className="flex items-center justify-between gap-2 text-[12px]">
                            <span className="truncate text-ink-600">{p.name}</span>
                            <span className="shrink-0 tabular-nums text-ink-900">
                              {formatWon(q.total)}
                              <span className="ml-1 text-ink-400">
                                (배송비 {q.fee === 0n ? '무료' : formatWon(q.fee)})
                              </span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </Card>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
