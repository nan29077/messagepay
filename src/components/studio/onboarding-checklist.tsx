import Link from 'next/link';
import { ChevronRight, Circle, CircleCheck, ListChecks } from 'lucide-react';
import { Card, cx } from '@/components/ui';
import { prisma } from '@/server/db';

/**
 * 신규 가맹 서비스 온보딩 체크리스트.
 *
 * 콘솔 맨 위에 붙어 "지금 무엇을 더 해야 결제를 받을 수 있는지" 를 보여준다.
 * 표시된 항목이 모두 끝나면 카드 자체가 사라진다.
 * 세 항목 모두 서버가 표를 보고 자동으로 판별한다(직접 체크 항목 없음).
 */

interface ChecklistItem {
  key: string;
  label: string;
  /** 미완료일 때 무엇을 하면 되는지 한 줄 안내 */
  hint: string;
  done: boolean;
  href: string;
  linkLabel: string;
}

export async function OnboardingChecklist({ merchantId }: { merchantId: string }) {
  const [profile, moNumber, account, productCount, settings] = await Promise.all([
    prisma.merchantProfile.findUnique({
      where: { id: merchantId },
      select: { businessNo: true },
    }),
    prisma.merchantMoNumber.findFirst({
      where: { merchantId, status: 'ASSIGNED' },
      select: { id: true },
    }),
    prisma.settlementAccount.findUnique({
      where: { merchantId },
      select: { verified: true },
    }),
    // 상품이 하나도 없고 직접 입력도 꺼져 있으면 결제 자체가 불가능하다.
    // 체크리스트가 이걸 안 짚어 주면 가맹점은 "왜 결제가 안 되지" 를 혼자 찾아야 한다.
    prisma.chargeProduct.count({ where: { merchantId, active: true, archivedAt: null } }),
    prisma.merchantProfile.findUnique({ where: { id: merchantId }, select: { allowCustomAmount: true } }),
  ]);

  const items: ChecklistItem[] = [
    {
      key: 'product',
      label: '판매할 상품 등록',
      hint: '노출 중인 상품이 없습니다. 상품이 없고 직접 입력도 꺼져 있으면 이용자가 결제를 진행할 수 없습니다.',
      done: productCount > 0 || (settings?.allowCustomAmount ?? false),
      href: '/studio/products/new?kind=physical',
      linkLabel: '등록하러 가기',
    },
    {
      key: 'moNumber',
      label: '결제 수신번호 배정',
      hint: '아직 배정된 결제 수신번호가 없습니다. 관리자에게 문의하세요.',
      done: Boolean(moNumber),
      href: '/support',
      linkLabel: '문의하기',
    },
    {
      key: 'settlementAccount',
      label: '정산 계좌 등록·인증',
      hint: '정산 대금을 받을 계좌를 등록하고 실명 확인을 마쳐 주세요.',
      done: account?.verified ?? false,
      href: '/studio/settlement/account',
      linkLabel: '등록하러 가기',
    },
    {
      key: 'businessNo',
      label: '사업자 정보 등록',
      hint: '정산 시 세금계산서 발행에 필요합니다.',
      done: Boolean(profile?.businessNo),
      href: '/studio/profile',
      linkLabel: '입력하러 가기',
    },
  ];

  const doneCount = items.filter((i) => i.done).length;
  if (doneCount === items.length) return null;

  return (
    <Card padded={false}>
      <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
        <p className="flex items-center gap-2 text-[13px] font-bold text-ink-900">
          <ListChecks size={17} strokeWidth={1.7} className="text-brand-700" />
          결제 시작 준비
          <span className="text-[11.5px] font-medium text-ink-400">
            남은 항목을 마치면 이 카드는 사라집니다
          </span>
        </p>
        <span className="shrink-0 text-[12px] font-extrabold tabular-nums text-brand-700">
          {doneCount}/{items.length} 완료
        </span>
      </div>

      <div className="h-1 w-full bg-ink-100">
        <div
          className="h-full bg-brand-700 transition-[width]"
          style={{ width: `${Math.round((doneCount / items.length) * 100)}%` }}
        />
      </div>

      <ul>
        {items.map((item) => (
          <li
            key={item.key}
            className="flex items-start justify-between gap-3 border-b border-ink-100 px-4 py-3 last:border-0"
          >
            <span className="flex min-w-0 items-start gap-2.5">
              {item.done ? (
                <CircleCheck size={17} strokeWidth={1.7} className="mt-0.5 shrink-0 text-success-500" />
              ) : (
                <Circle size={17} strokeWidth={1.7} className="mt-0.5 shrink-0 text-ink-300" />
              )}
              <span className="min-w-0">
                <span
                  className={cx(
                    'block text-[13.5px]',
                    item.done ? 'font-semibold text-ink-300' : 'font-bold text-ink-900',
                  )}
                >
                  {item.label}
                </span>
                {item.done ? null : (
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-500">{item.hint}</span>
                )}
              </span>
            </span>

            {item.done ? null : (
              <span className="flex shrink-0 flex-col items-end gap-1.5">
                <Link
                  href={item.href}
                  className="flex items-center gap-0.5 text-[12.5px] font-semibold text-brand-700 hover:underline"
                >
                  {item.linkLabel}
                  <ChevronRight size={14} strokeWidth={1.8} />
                </Link>
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
