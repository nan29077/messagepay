import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MessageSquare, Smartphone, CreditCard, ShieldCheck, CircleAlert,
  Gauge, Flag, Hash, Phone,
} from 'lucide-react';
import { PublicShell } from '@/components/layout/public-shell';
import { CreatorCodeForm } from '@/components/creator-code-form';
import { CopyButton } from '@/components/public/copy-button';
import { maskDisplayName } from '@/components/public/mask';
import { Card, CardTitle, SectionTitle, Notice, Badge, EmptyState, LinkButton, DataRow } from '@/components/ui';
import { normalizeCreatorCode } from '@/lib/id';
import { formatWon, formatNumber } from '@/lib/money';
import { formatKst } from '@/lib/datetime';
import { prisma } from '@/server/db';
import { resolvePolicy } from '@/server/services/limits';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ code: string }> };

async function findCreator(rawCode: string) {
  const code = normalizeCreatorCode(rawCode);
  if (!/^TOR-[A-Z0-9]{2,10}$/.test(code)) return null;
  return prisma.creatorProfile.findFirst({
    where: { code, status: 'APPROVED' },
    include: { moRoutes: { where: { status: 'ASSIGNED' } } },
  });
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { code } = await params;
  const creator = await findCreator(code);
  if (!creator) {
    return { title: '크리에이터를 찾을 수 없습니다 | 토네이도', robots: { index: false, follow: false } };
  }
  return {
    title: `${creator.displayName} 문자후원 | 토네이도`,
    description: `${creator.displayName} 님에게 문자 한 통으로 응원을 보내세요. 문자 1건당 ${formatWon(creator.donationAmount)}.`,
    robots: { index: false, follow: false },
  };
}

export default async function CreatorDonationPage({ params }: Params) {
  const { code } = await params;
  const creator = await findCreator(code);

  if (!creator) return <NotFoundView />;

  const [policy, donations] = await Promise.all([
    resolvePolicy(creator.id),
    prisma.donation.findMany({
      where: {
        creatorId: creator.id,
        status: { in: ['BROADCASTED', 'SETTLEMENT_PENDING', 'PARTIAL_DELIVERY_FAILED', 'SETTLED'] },
      },
      orderBy: { paidAt: 'desc' },
      take: 10,
      select: { id: true, displayName: true, amount: true, message: true, paidAt: true, anonymous: true },
    }),
  ]);

  const route = creator.moRoutes[0] ?? null;
  const keyword = route?.keyword ?? null;
  const shared = route?.mode === 'SHARED_PREFIX';
  const exampleBody = shared && keyword ? `${keyword} 응원합니다` : '응원합니다';
  const smsHref = route ? `sms:${route.phoneNumber}?body=${encodeURIComponent(exampleBody)}` : null;

  return (
    <PublicShell aside={<CreatorAside code={creator.code} amount={creator.donationAmount} />}>
      {/* 크리에이터 정보 */}
      <section>
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Badge tone="brand">문자후원</Badge>
              <h1 className="mt-2 text-[22px] font-extrabold leading-snug tracking-tight text-ink-900">
                {creator.displayName}
              </h1>
              {creator.channelName ? (
                <p className="mt-0.5 text-[13px] text-ink-500">{creator.channelName}</p>
              ) : null}
            </div>
            <span className="shrink-0 rounded-lg bg-ink-50 px-2.5 py-1.5 font-mono text-[12.5px] font-bold tracking-[0.08em] text-ink-700">
              {creator.code}
            </span>
          </div>
          {creator.description ? (
            <p className="mt-3 whitespace-pre-line border-t border-ink-100 pt-3 text-[13px] leading-relaxed text-ink-500">
              {creator.description}
            </p>
          ) : null}
        </Card>
      </section>

      {/* 후원 번호 */}
      <section className="mt-4">
        <SectionTitle title="후원 번호" description="아래 번호로 응원 메시지를 보내면 후원이 접수됩니다." />
        {route ? (
          <Card className="border border-brand-100">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[12px] font-semibold text-brand-600">
                  <Phone size={14} strokeWidth={1.8} />
                  {shared ? '대표번호 (키워드 필요)' : '전용 후원 번호'}
                </p>
                <p className="mt-1 font-mono text-[28px] font-extrabold leading-none tracking-tight text-ink-900">
                  {route.phoneNumber}
                </p>
              </div>
              <CopyButton value={route.phoneNumber} label="번호 복사" />
            </div>

            {shared && keyword ? (
              <div className="mt-4 rounded-xl border border-warning-500/30 bg-warning-50 px-4 py-3">
                <p className="flex items-center gap-1.5 text-[12px] font-bold text-ink-900">
                  <Hash size={14} strokeWidth={1.8} />
                  메시지 맨 앞에 키워드를 붙여 보내세요
                </p>
                <div className="mt-2 flex items-start justify-between gap-3">
                  <p className="min-w-0 break-all rounded-lg bg-white px-3 py-2 font-mono text-[15px] font-bold text-ink-900">
                    {exampleBody}
                  </p>
                  <CopyButton value={exampleBody} label="문구 복사" />
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-ink-700">
                  키워드 <span className="font-mono font-bold">{keyword}</span> 없이 보내면 어느 크리에이터에게 보내는
                  후원인지 확인할 수 없어 처리되지 않습니다.
                </p>
              </div>
            ) : (
              <p className="mt-3 text-[12.5px] leading-relaxed text-ink-500">
                이 번호는 {creator.displayName} 님 전용입니다. 메시지 내용은 자유롭게 작성하세요.
              </p>
            )}

            <div className="mt-4 rounded-xl bg-ink-50 px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-ink-500">문자 1건당 후원금</span>
                <span className="text-[20px] font-extrabold tracking-tight text-brand-600">
                  {formatWon(creator.donationAmount)}
                </span>
              </div>
            </div>

            {smsHref ? (
              <>
                <a
                  href={smsHref}
                  className="mt-4 inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-brand-500 text-[16px] font-semibold text-white transition-colors hover:bg-brand-600 active:bg-brand-700"
                >
                  <MessageSquare size={18} strokeWidth={1.7} />
                  문자 보내기
                </a>
                <p className="mt-2 flex gap-2 text-[12px] leading-relaxed text-ink-400">
                  <Smartphone size={14} strokeWidth={1.7} className="mt-0.5 shrink-0" />
                  <span>
                    휴대전화에서 문자 앱이 열리며 예시 문구가 미리 입력됩니다. 기기에 따라 내용이 자동으로 채워지지 않을
                    수 있으니 직접 확인 후 발송해 주세요.
                  </span>
                </p>
              </>
            ) : null}
          </Card>
        ) : (
          <Notice tone="warning" title="후원 번호가 아직 배정되지 않았습니다">
            이 크리에이터에게는 아직 문자 수신 번호가 배정되지 않아 문자후원을 접수할 수 없습니다. 번호가 배정되면 이
            페이지에 표시됩니다.
          </Notice>
        )}
      </section>

      {/* 이용 안내 */}
      <section className="mt-8">
        <SectionTitle title="후원 전 확인" />
        <Notice tone="warning" title="처음 보내는 문자는 후원되지 않습니다">
          최초 문자는 계좌 등록 안내만 발송되고 후원으로 접수되지 않습니다. 안내 문자의 링크에서 계좌 등록과 이용
          동의를 마친 뒤 다시 문자를 보내주세요.
        </Notice>
        <div className="mt-2.5 space-y-2.5">
          <Guide
            icon={<CreditCard size={17} strokeWidth={1.7} />}
            title="계좌 등록이 필요합니다"
            body="본인 명의 계좌를 1회 등록하면 이후에는 문자만 보내면 됩니다. 계좌번호 원문은 저장하지 않고 은행명과 끝 4자리만 보관합니다."
          />
          <Guide
            icon={<ShieldCheck size={17} strokeWidth={1.7} />}
            title="문자를 보내면 계좌에서 출금됩니다"
            body="결제 확인 문자의 버튼을 누르면 등록한 계좌에서 후원금이 출금됩니다. 확인하지 않으면 결제되지 않고 요청은 만료됩니다."
          />
          <Guide
            icon={<CircleAlert size={17} strokeWidth={1.7} />}
            title="결제되지 않은 메시지는 방송에 표시되지 않습니다"
            body="결제가 완료된 후원만 유튜브 채팅과 방송 오버레이, 음성 안내로 전달됩니다."
          />
          <Guide
            icon={<Gauge size={17} strokeWidth={1.7} />}
            title="이용 한도가 적용됩니다"
            body={`1일 ${formatWon(policy.donorDailyLimit)}, 1개월 ${formatWon(policy.donorMonthlyLimit)}, 이 크리에이터에게는 1일 ${formatWon(policy.perCreatorDailyLimit)}까지 후원할 수 있습니다. ${formatNumber(policy.velocityWindowSec)}초 내 ${formatNumber(policy.velocityMaxCount)}건을 넘으면 잠시 대기해야 합니다. 만 19세 미만은 이용할 수 없습니다.`}
          />
        </div>
        <div className="mt-3">
          <LinkButton href="/how-it-works" variant="secondary" size="md" className="w-full">
            이용방법 자세히 보기
          </LinkButton>
        </div>
      </section>

      {/* 최근 후원 */}
      <section className="mt-8">
        <SectionTitle title="최근 후원" description="결제가 완료된 후원만 표시되며, 후원자 이름은 일부만 공개됩니다." />
        {donations.length === 0 ? (
          <EmptyState title="아직 표시할 후원이 없습니다" description="첫 번째 응원 메시지를 보내보세요." />
        ) : (
          <div className="space-y-2">
            {donations.map((d) => (
              <Card key={d.id} className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] font-bold text-ink-900">
                    {d.anonymous ? '익명' : maskDisplayName(d.displayName)}
                  </span>
                  <span className="text-[14px] font-extrabold tracking-tight text-brand-600">
                    {formatWon(d.amount)}
                  </span>
                </div>
                {d.message ? (
                  <p className="mt-1.5 break-words text-[13px] leading-relaxed text-ink-700">{d.message}</p>
                ) : null}
                <p className="mt-1.5 text-[11.5px] text-ink-300">{formatKst(d.paidAt, false)}</p>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* 신고 */}
      <section className="mt-8">
        <Card>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink-50 text-brand-600">
              <Flag size={17} strokeWidth={1.7} />
            </span>
            <div>
              <CardTitle>문제가 있나요</CardTitle>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
                부적절한 후원 유도, 결제 오류, 원치 않는 후원 노출은 고객센터로 신고해 주세요. 거래번호를 함께 알려주시면
                빠르게 확인할 수 있습니다.
              </p>
              <LinkButton href="/support" variant="secondary" size="sm" className="mt-2.5">
                신고 · 문의하기
              </LinkButton>
            </div>
          </div>
        </Card>
      </section>
    </PublicShell>
  );
}

function Guide({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <Card className="flex gap-3">
      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
        {icon}
      </span>
      <div>
        <p className="text-[13.5px] font-bold text-ink-900">{title}</p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-500">{body}</p>
      </div>
    </Card>
  );
}

function CreatorAside({ code, amount }: { code: string; amount: bigint }) {
  return (
    <div className="sticky top-24 space-y-3">
      <Card>
        <CardTitle>후원 요약</CardTitle>
        <div className="mt-2">
          <DataRow label="크리에이터 코드" value={<span className="font-mono">{code}</span>} />
          <DataRow label="문자 1건당" value={formatWon(amount)} />
          <DataRow label="최초 문자" value="후원 처리 안 됨" />
          <DataRow label="결제 방식" value="계좌 자동출금" />
        </div>
      </Card>
      <Card>
        <CardTitle>다른 크리에이터 찾기</CardTitle>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-500">
          토네이도는 크리에이터 목록을 공개하지 않습니다. 방송에 안내된 코드를 입력해 주세요.
        </p>
        <div className="mt-3">
          <CreatorCodeForm />
        </div>
      </Card>
      <p className="px-1 text-[11.5px] leading-relaxed text-ink-400">
        토네이도 후원은 유튜브 공식 슈퍼챗이 아닌 외부 후원 서비스입니다.{' '}
        <Link href="/how-it-works" className="font-semibold text-brand-600">
          이용방법
        </Link>
      </p>
    </div>
  );
}

function NotFoundView() {
  return (
    <PublicShell>
      <div className="pt-6">
        <Card>
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-warning-50 text-warning-500">
            <CircleAlert size={20} strokeWidth={1.7} />
          </span>
          <h1 className="mt-3 text-[19px] font-extrabold leading-snug tracking-tight text-ink-900">
            크리에이터를 찾을 수 없습니다.
          </h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-500">
            방송 화면 또는 크리에이터 프로필에 안내된 코드를 다시 확인해 주세요. 승인 전이거나 이용이 정지된
            크리에이터의 코드도 조회되지 않습니다.
          </p>
          <div className="mt-4">
            <CreatorCodeForm autoFocus />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <LinkButton href="/" variant="secondary" size="md" className="w-full">
              홈으로
            </LinkButton>
            <LinkButton href="/support" variant="secondary" size="md" className="w-full">
              고객센터
            </LinkButton>
          </div>
        </Card>
      </div>
    </PublicShell>
  );
}
