import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Camera, Music2, Radio, Video } from 'lucide-react';
import { Badge, Card, CardTitle, DataRow, Field, Input, Notice, SectionTitle, Textarea, cx } from '@/components/ui';
import { DEFAULT_BANNERS, defaultBannerFor } from '@/lib/banners';
import { PageHeader } from '@/components/layout/console-shell';
import { ActionForm } from '@/components/studio/action-form';
import { DonationPageShare } from '@/components/studio/donation-page-share';
import { updateDonationSettingsAction, updateDonationPageAction } from '@/app/actions/studio';
import { requireCreator } from '@/server/auth';
import { prisma } from '@/server/db';
import { resolvePolicy } from '@/server/services/limits';
import { env } from '@/lib/env';
import { formatWon } from '@/lib/money';
import { moNumberStatusLabel, paymentModeLabel } from '@/lib/labels';
import { getPublicBaseUrl } from '@/server/public-base-url';

export const dynamic = 'force-dynamic';

const SETTINGS_TABS = [
  { key: 'amount', label: '후원금' },
  { key: 'payment', label: '결제 모드' },
  { key: 'number', label: '문자번호' },
  { key: 'page', label: '후원페이지' },
] as const;

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

  const [creator, moNumbers, policy] = await Promise.all([
    prisma.creatorProfile.findUnique({
      where: { id: creatorId },
      select: {
        id: true,
        code: true,
        displayName: true,
        description: true,
        donationAmount: true,
        minAmount: true,
        maxAmount: true,
        paymentMode: true,
        bannerUrl: true,
        liveOn: true,
        liveUrl: true,
        livePlatform: true,
        youtubeLiveUrl: true,
        instagramLiveUrl: true,
        tiktokLiveUrl: true,
      },
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

  return (
    <>
      <PageHeader title="후원 설정" description="문자 1건당 후원금과 수신번호, 후원 페이지 정보를 관리합니다." />

      <nav
        aria-label="후원 설정 메뉴"
        className="mb-5 grid grid-cols-4 overflow-hidden rounded-2xl border border-ink-100 bg-white p-1 shadow-[0_8px_24px_rgba(23,22,26,0.05)]"
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
          <SectionTitle title="문자 1건당 후원금" description="후원자가 문자 1건을 보낼 때 결제되는 금액입니다." />
          <Card>
            <ActionForm action={updateDonationSettingsAction} submitLabel="후원금 저장">
              <Field
                label="문자 1건당 후원금 (원)"
                hint={`설정 가능 범위: ${formatWon(effMin)} ~ ${formatWon(effMax)} (관리자 정책 반영)`}
              >
                <Input
                  name="donationAmount"
                  inputMode="numeric"
                  defaultValue={creator.donationAmount.toString()}
                  className="tabular-nums"
                />
              </Field>
            </ActionForm>

            <div className="mt-4">
              <DataRow label="현재 설정 금액" value={formatWon(creator.donationAmount)} />
              <DataRow label="설정 가능 범위" value={`${formatWon(effMin)} ~ ${formatWon(effMax)}`} />
              <DataRow label="한도 정책 1건 허용 범위" value={`${formatWon(policy.minAmount)} ~ ${formatWon(policy.maxAmount)}`} />
              <DataRow label="후원자 1인 1일 한도" value={formatWon(policy.donorDailyLimit)} />
              <DataRow label="내 채널 기준 후원자 1일 한도" value={formatWon(policy.perCreatorDailyLimit)} />
            </div>
          </Card>
        </section> : null}

        {activeTab === 'payment' ? <section>
          <SectionTitle title="결제 모드" description="결제 모드는 크리에이터가 변경할 수 없습니다." />
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
            <Notice tone="warning" title="즉시형은 크리에이터가 켤 수 없습니다">
              즉시형(DIRECT_TRIGGER)은 금융사 서면승인 등록 후 통합 관리자만 활성화할 수 있습니다. 문자 수신 즉시
              출금이 일어나는 방식이므로, 서면승인 없이 사용하면 전자금융거래 관련 규정을 위반할 수 있습니다. 변경이
              필요하면 고객센터를 통해 신청해 주세요.
            </Notice>
          </Card>
        </section> : null}

        {activeTab === 'number' ? <section>
          <SectionTitle title="MO 수신번호" description="후원자가 문자를 보내는 번호입니다. 배정과 변경은 통합 관리자가 처리합니다." />
          <Card>
            {moNumbers.length === 0 ? (
              <Notice tone="warning">
                배정된 수신번호가 없습니다. 번호가 배정되기 전에는 문자후원을 받을 수 없습니다. 고객센터로 배정을
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
            title="후원페이지 꾸미기"
            description="시청자에게 공유하는 페이지의 배너·소개·라이브 표시를 관리합니다."
          />
          <Card>
            <div className="mb-5">
              <DonationPageShare url={donationPageUrl} creatorName={creator.displayName} />
            </div>

            <ActionForm action={updateDonationPageAction} submitLabel="후원페이지 설정 저장">
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
                <div className="mt-2">
                  <Input
                    name="bannerUrl"
                    defaultValue={
                      creator.bannerUrl && !DEFAULT_BANNERS.includes(creator.bannerUrl as (typeof DEFAULT_BANNERS)[number])
                        ? creator.bannerUrl
                        : ''
                    }
                    placeholder="직접 입력 선택 시: /이미지 경로 또는 https:// (권장 비율 3:1 이상)"
                  />
                </div>
              </div>

              <Field label="크리에이터 소개" hint="후원페이지 상단 프로필 아래에 표시됩니다. 300자 이내.">
                <Textarea name="description" rows={3} maxLength={300} defaultValue={creator.description ?? ''} />
              </Field>

              <div>
                <p className="text-[13px] font-bold text-ink-900">라이브 연결</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-ink-400">
                  사용할 플랫폼을 선택하고 해당 라이브 주소를 입력하세요. 프로필과 온에어 버튼이 선택한 방송으로 연결됩니다.
                </p>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  {([
                    { value: 'YOUTUBE', label: '유튜브', icon: Video },
                    { value: 'INSTAGRAM', label: '인스타그램', icon: Camera },
                    { value: 'TIKTOK', label: '틱톡', icon: Music2 },
                  ] as const).map((platform) => {
                    const Icon = platform.icon;
                    const selected = (creator.livePlatform ?? 'YOUTUBE') === platform.value;
                    return (
                      <label key={platform.value} className="cursor-pointer">
                        <input type="radio" name="livePlatform" value={platform.value} defaultChecked={selected} className="peer sr-only" />
                        <span className="flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-ink-200 bg-white px-2 text-[11.5px] font-bold text-ink-500 transition-all peer-checked:border-brand-400 peer-checked:bg-brand-50 peer-checked:text-ink-900 peer-checked:shadow-sm sm:text-[12.5px]">
                          <Icon size={15} /> {platform.label}
                        </span>
                      </label>
                    );
                  })}
                </div>

                <div className="mt-3 space-y-2.5">
                  <Field label="유튜브 라이브 주소" hint="youtube.com 또는 youtu.be 주소">
                    <Input name="youtubeLiveUrl" defaultValue={creator.youtubeLiveUrl ?? creator.liveUrl ?? ''} placeholder="https://www.youtube.com/watch?v=..." />
                  </Field>
                  <Field label="인스타그램 라이브 주소" hint="instagram.com 주소">
                    <Input name="instagramLiveUrl" defaultValue={creator.instagramLiveUrl ?? ''} placeholder="https://www.instagram.com/..." />
                  </Field>
                  <Field label="틱톡 라이브 주소" hint="tiktok.com 주소">
                    <Input name="tiktokLiveUrl" defaultValue={creator.tiktokLiveUrl ?? ''} placeholder="https://www.tiktok.com/@.../live" />
                  </Field>
                </div>

                <label className="mt-4 flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3.5">
                  <span>
                    <span className="flex items-center gap-1.5 text-[13px] font-extrabold text-ink-900">
                      <Radio size={15} strokeWidth={1.8} className="text-danger-500" /> 현재 방송중
                    </span>
                    <span className="mt-0.5 block text-[11.5px] text-ink-400">켜면 프로필이 뛰고 온에어 버튼이 표시됩니다.</span>
                  </span>
                  <input type="checkbox" name="liveOn" defaultChecked={creator.liveOn} className="peer sr-only" />
                  <span className="relative h-7 w-12 shrink-0 rounded-full bg-ink-200 transition-colors after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-brand-400 peer-checked:after:translate-x-5" />
                </label>
              </div>

              <Notice tone="brand">
                방송중 스위치를 켜면 후원페이지 프로필이 두근두근 움직이고, 프로필 아래에 온에어 배지가 표시되어
                시청자가 바로 라이브로 이동할 수 있습니다. 방송이 끝나면 스위치를 꺼주세요.
              </Notice>
            </ActionForm>
          </Card>
        </section> : null}
      </div>
    </>
  );
}
