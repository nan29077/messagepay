import { notFound } from 'next/navigation';
import Link from 'next/link';
import { MessageSquareText, Video } from 'lucide-react';
import { Badge, Card, CardTitle, DataRow, Field, Input, Notice, SectionTitle, Textarea, cx } from '@/components/ui';
import { DEFAULT_BANNERS, defaultBannerFor } from '@/lib/banners';
import { PageHeader } from '@/components/layout/console-shell';
import { ActionForm, InlineActionForm } from '@/components/studio/action-form';
import { ImageUploadField } from '@/components/studio/image-upload-field';
import { DonationPageShare } from '@/components/studio/donation-page-share';
import {
  updateChargeSettingsAction,
  createChargeProductAction,
  updateChargeProductAction,
  archiveChargeProductAction,
  updateDonationPageAction,
  updateThanksMessageAction,
} from '@/app/actions/studio';
import { THANKS_MT_MAX_LENGTH, THANKS_MT_VARIABLES, tplDonationSuccess } from '@/server/services/mt-templates';
import { requireCreator } from '@/server/auth';
import { prisma } from '@/server/db';
import { resolvePolicy } from '@/server/services/limits';
import { env } from '@/lib/env';
import { formatWon } from '@/lib/money';
import { moNumberStatusLabel, paymentModeLabel } from '@/lib/labels';
import { getPublicBaseUrl } from '@/server/public-base-url';

export const dynamic = 'force-dynamic';

const SETTINGS_TABS = [
  { key: 'amount', label: '충전 상품' },
  { key: 'thanks', label: '감사문자' },
  { key: 'payment', label: '결제 모드' },
  { key: 'number', label: '문자번호' },
  { key: 'page', label: '결제페이지' },
] as const;

/** 감사 문자 미리보기 예시값. 실제 발송과 같은 템플릿 함수에 넣어 결과를 보여준다. */
const THANKS_PREVIEW = {
  donorName: '홍길동',
  creatorName: '문자페이',
  amount: 3_000n,
  message: '캐시 충전합니다',
  cumulative: 12_000n,
} as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]['key'];

export default async function StudioSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { creatorId } = await requireCreator();
  const requestedTab = (await searchParams).tab;
  const activeTab: SettingsTab = SETTINGS_TABS.some((tab) => tab.key === requestedTab)
    ? requestedTab as SettingsTab
    : 'amount';

  const [creator, products, moNumbers, policy] = await Promise.all([
    prisma.creatorProfile.findUnique({
      where: { id: creatorId },
      select: {
        id: true,
        code: true,
        displayName: true,
        description: true,
        allowCustomAmount: true,
        minAmount: true,
        maxAmount: true,
        paymentMode: true,
        thanksMtMessage: true,
        bannerUrl: true,
      },
    }),
    prisma.chargeProduct.findMany({
      where: { creatorId, archivedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { amount: 'asc' }],
    }),
    prisma.creatorMoNumber.findMany({
      where: { creatorId },
      orderBy: { assignedAt: 'desc' },
      select: { id: true, phoneNumber: true, keyword: true, mode: true, status: true, assignedAt: true },
    }),
    resolvePolicy(creatorId, null),
  ]);

  if (!creator) notFound();

  const effectiveMode = creator.paymentMode ?? 'CONFIRM_LINK';
  // 설정 가능 범위 = 관리자 지정 범위 ∩ 한도 정책 범위
  const effMin = creator.minAmount > policy.minAmount ? creator.minAmount : policy.minAmount;
  const effMax = creator.maxAmount < policy.maxAmount ? creator.maxAmount : policy.maxAmount;
  const donationPageUrl = `${await getPublicBaseUrl()}/c/${creator.code}`;

  // 지금 설정으로 실제 발송되는 문장과, 설정을 비웠을 때의 기본 문장.
  const thanksPreview = tplDonationSuccess({
    ...THANKS_PREVIEW,
    creatorName: creator.displayName,
    custom: creator.thanksMtMessage,
  }).text;
  const thanksDefaultPreview = tplDonationSuccess({
    ...THANKS_PREVIEW,
    creatorName: creator.displayName,
  }).text;

  return (
    <>
      <PageHeader title="결제 설정" description="문자 1건당 결제 금액과 수신번호, 결제 페이지 정보를 관리합니다." />

      <nav
        aria-label="결제 설정 메뉴"
        className="mb-5 grid grid-cols-5 overflow-hidden rounded-2xl border border-ink-100 bg-white p-1 shadow-[0_8px_24px_rgba(23,22,26,0.05)]"
      >
        {SETTINGS_TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`/studio/settings?tab=${tab.key}`}
            aria-current={activeTab === tab.key ? 'page' : undefined}
            className={cx(
              'flex min-h-11 items-center justify-center rounded-xl px-1 text-center text-[12px] font-bold transition-colors sm:px-3 sm:text-[13px]',
              activeTab === tab.key ? 'bg-brand-400 text-ink-900 shadow-sm' : 'text-ink-400 hover:bg-ink-50 hover:text-ink-800',
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="space-y-5">
        {activeTab === 'amount' ? <section>
          <SectionTitle
            title="충전 상품"
            description="이용자가 문자를 보내면 여기에 등록한 상품 중에서 금액을 고릅니다. 결제 금액과 지급 포인트는 1:1 입니다."
          />

          <Card>
            <CardTitle>등록한 상품</CardTitle>
            <p className="mb-3 mt-1 text-[12.5px] leading-relaxed text-ink-500">
              등록 가능 범위: {formatWon(effMin)} ~ {formatWon(effMax)} (관리자 정책 반영). 사용을 끄면 선택 화면에서 감춰집니다.
            </p>

            {products.length === 0 ? (
              <Notice tone="warning">
                등록된 상품이 없습니다. 상품이 없고 직접 입력도 꺼져 있으면 이용자가 결제를 진행할 수 없습니다.
              </Notice>
            ) : (
              <div className="space-y-2.5">
                {products.map((p) => (
                  <div key={p.id} className="rounded-2xl border border-ink-100 p-3">
                    <ActionForm action={updateChargeProductAction} submitLabel="저장" variant="secondary" size="sm">
                      <input type="hidden" name="productId" value={p.id} />
                      <div className="grid gap-2.5 sm:grid-cols-[2fr_1fr_0.7fr_auto]">
                        <Field label="이름">
                          <Input name="name" defaultValue={p.name} maxLength={40} />
                        </Field>
                        <Field label="금액 (원)">
                          <Input name="amount" inputMode="numeric" defaultValue={p.amount.toString()} className="tabular-nums" />
                        </Field>
                        <Field label="순서">
                          <Input name="sortOrder" inputMode="numeric" defaultValue={String(p.sortOrder)} className="tabular-nums" />
                        </Field>
                        <label className="flex items-end gap-2 pb-2 text-[12.5px] font-semibold text-ink-700">
                          <input type="checkbox" name="active" defaultChecked={p.active} className="h-4 w-4" />
                          사용
                        </label>
                      </div>
                    </ActionForm>
                    <div className="mt-2 flex justify-end">
                      <InlineActionForm
                        action={archiveChargeProductAction}
                        submitLabel="보관"
                        variant="ghost"
                        confirmMessage={`${p.name} 상품을 보관합니다. 선택 화면에서 사라지며, 지난 결제 내역은 그대로 남습니다.`}
                        fields={{ productId: p.id }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="mt-4">
            <CardTitle>상품 추가</CardTitle>
            <div className="mt-3">
              <ActionForm action={createChargeProductAction} submitLabel="상품 추가">
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <Field label="상품 이름" hint="예: 10,000 포인트">
                    <Input name="name" maxLength={40} placeholder="10,000 포인트" />
                  </Field>
                  <Field label="금액 (원)" hint={`${formatWon(effMin)} ~ ${formatWon(effMax)}`}>
                    <Input name="amount" inputMode="numeric" placeholder="10000" className="tabular-nums" />
                  </Field>
                </div>
              </ActionForm>
            </div>
          </Card>

          <Card className="mt-4">
            <CardTitle>직접 입력</CardTitle>
            <p className="mb-3 mt-1 text-[12.5px] leading-relaxed text-ink-500">
              허용하면 이용자가 목록에 없는 금액을 직접 넣을 수 있습니다. 입력 가능 범위는 위와 같습니다.
            </p>
            <ActionForm action={updateChargeSettingsAction} submitLabel="저장">
              <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-800">
                <input
                  type="checkbox"
                  name="allowCustomAmount"
                  defaultChecked={creator.allowCustomAmount}
                  className="h-4 w-4"
                />
                직접 입력 허용
              </label>
            </ActionForm>

            <div className="mt-4">
              <DataRow label="등록 가능 범위" value={`${formatWon(effMin)} ~ ${formatWon(effMax)}`} />
              <DataRow label="한도 정책 1건 허용 범위" value={`${formatWon(policy.minAmount)} ~ ${formatWon(policy.maxAmount)}`} />
              <DataRow label="이용자 1인 1일 한도" value={formatWon(policy.donorDailyLimit)} />
              <DataRow label="내 서비스 기준 이용자 1일 한도" value={formatWon(policy.perCreatorDailyLimit)} />
            </div>
          </Card>
        </section> : null}

        {activeTab === 'thanks' ? <section>
          <SectionTitle
            title="감사 문자 내용 설정"
            description="결제가 완료됐을 때 이용자에게 발송되는 문자 본문입니다."
          />
          <Card>
            <ActionForm action={updateThanksMessageAction} submitLabel="감사 문자 저장">
              <Field
                label="감사 문자 본문"
                hint={`${THANKS_MT_MAX_LENGTH}자 이내. 비워두면 기본 문구로 발송됩니다.`}
              >
                <Textarea
                  name="thanksMtMessage"
                  rows={4}
                  maxLength={THANKS_MT_MAX_LENGTH}
                  defaultValue={creator.thanksMtMessage ?? ''}
                  placeholder={'{이용자}님 감사합니다! {금액} 결제 잘 받았어요. 남겨주신 말: {메시지}'}
                />
              </Field>

              <div className="rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3">
                <p className="flex items-center gap-1.5 text-[12.5px] font-extrabold text-ink-900">
                  <MessageSquareText size={16} strokeWidth={1.7} className="text-brand-700" />
                  사용할 수 있는 치환자
                </p>
                <ul className="mt-2 space-y-1">
                  {THANKS_MT_VARIABLES.map((v) => (
                    <li key={v.token} className="flex items-center gap-2 text-[12px] text-ink-700">
                      <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[11.5px] font-bold text-brand-700">
                        {v.token}
                      </span>
                      {v.label}
                    </li>
                  ))}
                </ul>
              </div>
            </ActionForm>

            <div className="mt-5">
              <p className="text-[13px] font-bold text-ink-900">현재 설정으로 발송되는 문자</p>
              <p className="mt-2 whitespace-pre-wrap rounded-2xl bg-brand-50 px-4 py-3 text-[13px] leading-relaxed text-ink-900">
                {thanksPreview}
              </p>
              <p className="mt-1.5 text-[11.5px] text-ink-400">
                이용자 이름·금액·메시지는 실제 결제 값으로 바뀝니다. 저장한 뒤 화면이 갱신되면 위 미리보기도 함께
                바뀝니다.
              </p>
            </div>

            {creator.thanksMtMessage ? (
              <div className="mt-4">
                <p className="text-[13px] font-bold text-ink-900">기본 문구 (설정을 비우면 이 문구로 발송)</p>
                <p className="mt-2 whitespace-pre-wrap rounded-2xl bg-ink-50 px-4 py-3 text-[13px] leading-relaxed text-ink-500">
                  {thanksDefaultPreview}
                </p>
              </div>
            ) : null}

            <div className="mt-4">
              <Notice tone="warning" title="링크와 개인정보는 넣을 수 없습니다">
                감사 문자에 링크(http, www)나 전화번호·계좌번호를 넣으면 저장되지 않습니다. 통신사 스팸 차단으로 문자
                자체가 전달되지 않거나 이용자가 피싱으로 오인할 수 있기 때문입니다. 발신 주체 표기 [문자페이] 는 항상 문장
                앞에 자동으로 붙습니다.
              </Notice>
            </div>
          </Card>
        </section> : null}

        {activeTab === 'payment' ? <section>
          <SectionTitle title="결제 모드" description="결제 모드는 가맹점이 변경할 수 없습니다." />
          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <CardTitle>{paymentModeLabel[effectiveMode]}</CardTitle>
              <Badge tone="neutral">읽기 전용</Badge>
            </div>
            <div className="mb-3">
              <DataRow label="확인형 (CONFIRM_LINK)" value={paymentModeLabel.CONFIRM_LINK} />
              <DataRow label="즉시형 (DIRECT_TRIGGER)" value={paymentModeLabel.DIRECT_TRIGGER} />
              <DataRow
                label="즉시형 허용 여부"
                value={
                  env.safety.allowDirectTrigger ? (
                    <Badge tone="success">플랫폼 허용</Badge>
                  ) : (
                    <Badge tone="warning">전체 비활성</Badge>
                  )
                }
              />
            </div>
            <Notice tone="warning" title="즉시형은 가맹점이 켤 수 없습니다">
              즉시형(DIRECT_TRIGGER)은 금융사 서면승인 등록 후 통합 관리자만 활성화할 수 있습니다. 문자 수신 즉시
              출금이 일어나는 방식이므로, 서면승인 없이 사용하면 전자금융거래 관련 규정을 위반할 수 있습니다. 변경이
              필요하면 고객센터를 통해 신청해 주세요.
            </Notice>
          </Card>
        </section> : null}

        {activeTab === 'number' ? <section>
          <SectionTitle title="MO 수신번호" description="이용자가 문자를 보내는 번호입니다. 배정과 변경은 통합 관리자가 처리합니다." />
          <Card>
            {moNumbers.length === 0 ? (
              <Notice tone="warning">
                배정된 수신번호가 없습니다. 번호가 배정되기 전에는 문자결제를 받을 수 없습니다. 고객센터로 배정을
                요청해 주세요.
              </Notice>
            ) : (
              <div className="space-y-3">
                {moNumbers.map((mo) => (
                  <div key={mo.id} className="rounded-xl border border-ink-100 px-3 py-2">
                    <DataRow label="수신번호" value={<span className="font-mono">{mo.phoneNumber}</span>} />
                    <DataRow
                      label="수신 방식"
                      value={mo.mode === 'DEDICATED' ? '전용번호 (문자 내용만 전송)' : '대표번호 + 키워드'}
                    />
                    <DataRow label="키워드" value={mo.keyword ? <span className="font-mono">{mo.keyword}</span> : '없음'} />
                    <DataRow
                      label="상태"
                      value={<Badge tone={moNumberStatusLabel[mo.status].tone}>{moNumberStatusLabel[mo.status].text}</Badge>}
                    />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </section> : null}

        {activeTab === 'page' ? <section>
          <SectionTitle
            title="결제페이지 꾸미기"
            description="이용자에게 공유하는 페이지의 배너·소개·라이브 표시를 관리합니다."
          />
          <Card>
            <div className="mb-5">
              <DonationPageShare url={donationPageUrl} creatorName={creator.displayName} />
            </div>

            <ActionForm action={updateDonationPageAction} submitLabel="결제페이지 설정 저장">
              {/* 배너 선택: 기본 5종 + 직접 입력 */}
              <div>
                <p className="text-[13px] font-bold text-ink-900">상단 배너</p>
                <p className="mt-0.5 mb-2 text-[12px] text-ink-400">
                  기본 배너 5종 중 선택하거나 직접 이미지 주소를 입력할 수 있습니다. 선택하지 않으면 기본 배너가
                  자동 적용됩니다.
                </p>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  {DEFAULT_BANNERS.map((b, i) => {
                    const checked = creator.bannerUrl === b || (!creator.bannerUrl && defaultBannerFor(creator.id) === b);
                    return (
                      <label key={b} className="group relative cursor-pointer">
                        <input
                          type="radio"
                          name="bannerPreset"
                          value={b}
                          defaultChecked={checked}
                          className="peer sr-only"
                        />
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={b}
                          alt={`기본 배너 ${i + 1}`}
                          className="h-16 w-full rounded-xl border-2 border-transparent object-cover transition-all peer-checked:border-brand-500 peer-checked:shadow-[0_4px_14px_rgba(237,166,0,0.35)]"
                        />
                        <span className="absolute left-1.5 top-1.5 rounded bg-ink-900/60 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          기본 {i + 1}
                        </span>
                      </label>
                    );
                  })}
                  <label className="flex cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-ink-200 text-[12.5px] font-bold text-ink-500 transition-colors has-[:checked]:border-brand-500 has-[:checked]:text-brand-700">
                    <input
                      type="radio"
                      name="bannerPreset"
                      value="custom"
                      defaultChecked={Boolean(creator.bannerUrl) && !DEFAULT_BANNERS.includes(creator.bannerUrl as (typeof DEFAULT_BANNERS)[number])}
                      className="sr-only"
                    />
                    직접 입력
                  </label>
                </div>
                <div className="mt-3">
                  <ImageUploadField
                    name="bannerUrl"
                    label="직접 입력 배너 (파일 업로드 또는 URL)"
                    aspect="wide"
                    defaultValue={
                      creator.bannerUrl && !DEFAULT_BANNERS.includes(creator.bannerUrl as (typeof DEFAULT_BANNERS)[number])
                        ? creator.bannerUrl
                        : ''
                    }
                    hint="위에서 '직접 입력'을 선택한 경우 적용됩니다. 권장 비율 3:1 이상."
                  />
                </div>
              </div>

              <Field label="가맹점 소개" hint="결제페이지 상단 프로필 아래에 표시됩니다. 300자 이내.">
                <Textarea name="description" rows={3} maxLength={300} defaultValue={creator.description ?? ''} />
              </Field>

            </ActionForm>
          </Card>
        </section> : null}
      </div>
    </>
  );
}
