import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { Notice } from '@/components/ui';
import { PageHeader } from '@/components/layout/console-shell';
import { ProductForm } from '@/components/studio/product-form';
import { createChargeProductAction } from '@/app/actions/studio';
import { requireMerchant } from '@/server/auth';
import { prisma } from '@/server/db';
import { resolvePolicy } from '@/server/services/limits';
import { shippingPolicyOf } from '@/server/services/products';
import { MAX_CHARGE_PRODUCTS } from '@/components/studio/shared';
import type { ProductKind } from '@/generated/prisma/enums';

export const dynamic = 'force-dynamic';

/** 상품 등록. 종류는 주소로 받아 폼 구성을 바꾼다(등록 후에는 바꿀 수 없다). */
export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { merchantId } = await requireMerchant();
  const sp = await searchParams;
  const kind: ProductKind = sp.kind === 'digital' ? 'DIGITAL' : 'PHYSICAL';

  const [merchant, policy, shippingRow, count] = await Promise.all([
    prisma.merchantProfile.findUnique({
      where: { id: merchantId },
      select: { minAmount: true, maxAmount: true },
    }),
    resolvePolicy(merchantId, null),
    prisma.merchantShippingPolicy.findUnique({ where: { merchantId } }),
    prisma.chargeProduct.count({ where: { merchantId, kind, archivedAt: null } }),
  ]);
  if (!merchant) notFound();

  const effMin = merchant.minAmount > policy.minAmount ? merchant.minAmount : policy.minAmount;
  const effMax = merchant.maxAmount < policy.maxAmount ? merchant.maxAmount : policy.maxAmount;
  const full = count >= MAX_CHARGE_PRODUCTS;

  return (
    <>
      <Link
        href={`/studio/products?tab=${kind === 'DIGITAL' ? 'digital' : 'physical'}`}
        className="mb-2 inline-flex items-center gap-1 text-[12.5px] font-bold text-ink-500 hover:text-ink-900"
      >
        <ChevronLeft size={15} strokeWidth={1.8} />
        상품 관리로
      </Link>

      <PageHeader
        title={kind === 'DIGITAL' ? '비실물(컨텐츠) 상품 등록' : '실물 상품 등록'}
        description={`${kind === 'DIGITAL' ? '포인트 · 상품권 · 이용권 · 컨텐츠' : '배송이 필요한 상품'} 을(를) 등록합니다. 종류는 등록 후 바꿀 수 없습니다. (${count}/${MAX_CHARGE_PRODUCTS}개 사용)`}
      />

      {full ? (
        <Notice tone="warning" title={`${kind === 'DIGITAL' ? '비실물' : '실물'} 상품이 이미 ${MAX_CHARGE_PRODUCTS}개입니다`}>
          결제 화면이 감당할 수 있는 선택지 수라 종류별로 {MAX_CHARGE_PRODUCTS}개까지만 등록할 수 있습니다. 먼저 쓰지
          않는 상품을 보관해 주세요.
        </Notice>
      ) : (
        <ProductForm
          action={createChargeProductAction}
          kind={kind}
          product={null}
          options={[]}
          notice={null}
          images={[]}
          shipping={shippingPolicyOf(shippingRow)}
          effMin={effMin}
          effMax={effMax}
          submitLabel="상품 등록"
        />
      )}
    </>
  );
}
