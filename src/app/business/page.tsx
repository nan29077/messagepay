import type { Metadata } from 'next';
import {
  Building2, Cable, ClipboardCheck, Coins, FileText, Gamepad2, GraduationCap,
  Landmark, MessageSquareText, ReceiptText, ShieldCheck, ShoppingBag, Users,
} from 'lucide-react';
import { PublicShell } from '@/components/layout/public-shell';
import { PageHeader } from '@/components/public/page-header';
import { SupportForm } from '@/components/public/support-form';
import { BannerStrip } from '@/components/public/banner-strip';
import { Card, CardTitle, Notice, LinkButton, SectionTitle } from '@/components/ui';

/**
 * 서비스 도입 문의.
 *
 * 예전에는 이 메뉴가 고객센터 문의 접수(`/support`)로 이어져, 도입을 검토하러 온 사업자에게
 * "결제 취소·환불" 문의 화면이 떴다. 도입 검토에 필요한 안내(대상 서비스·절차·준비물·연동 방식)를
 * 먼저 보여 주고, 그 아래에서 상담을 접수한다. 개인 이용자 문의는 그대로 `/support` 에 남는다.
 */

export const metadata: Metadata = {
  title: '서비스 도입 문의',
  description:
    '게임 캐시, 멤버십 포인트, 콘텐츠 이용권 등 반복 충전이 필요한 서비스에 메시지페이를 연결하는 절차와 준비물을 안내합니다.',
};

const targets = [
  { icon: Gamepad2, title: '게임 · 앱', body: '캐시, 코인, 이용권처럼 자주 충전하는 디지털 포인트' },
  { icon: ShoppingBag, title: '커머스 · 멤버십', body: '선불금, 마일리지, 멤버십 잔액 충전' },
  { icon: GraduationCap, title: '교육 · 콘텐츠', body: '수강권, 열람권, 콘텐츠 크레딧' },
  { icon: Landmark, title: '생활 서비스', body: '주차, 세탁, 교통 등 반복 이용 서비스' },
];

const steps = [
  {
    icon: MessageSquareText,
    title: '도입 상담 접수',
    body: '아래 양식으로 서비스와 연동 환경을 알려주시면 담당자가 검토 후 연락드립니다.',
  },
  {
    icon: ClipboardCheck,
    title: '가맹점 가입 심사',
    body: '사업자 정보와 서비스 정보를 확인합니다. 승인되면 전용 결제 수신번호가 배정됩니다.',
  },
  {
    icon: Cable,
    title: '충전 반영 연동',
    body: '파트너 API 또는 결제 완료 콜백으로 기존 포인트·충전 시스템과 연결합니다.',
  },
  {
    icon: Coins,
    title: '운영 시작과 정산',
    body: '가맹점 관리자에서 상품·주문·환불을 처리하고, 지급일에 맞춰 자동 정산됩니다.',
  },
];

const prepare = [
  '사업자등록증 (개인 가맹점은 원천징수 신고 정보)',
  '서비스명과 서비스 주소, 충전 상품 구성(금액·지급 단위)',
  '충전 반영을 처리할 담당자 또는 개발 담당 연락처',
  '정산 대금을 받을 계좌 (예금주 실명확인 대상)',
];

export default function BusinessInquiryPage() {
  return (
    <PublicShell aside={<BusinessAside />}>
      <PageHeader
        eyebrow="FOR BUSINESS"
        title="메시지페이 도입 문의"
        description="문자 한 통으로 끝나는 결제·충전을 서비스에 연결합니다. 운영 환경과 필요한 연동 방식을 남겨주시면 담당자가 검토 후 안내드립니다."
      />

      <BannerStrip position="SUPPORT_TOP" className="mb-4" />

      <Notice tone="brand" title="이런 서비스에 맞습니다">
        게임 캐시, 멤버십 포인트, 콘텐츠 크레딧, 생활 서비스 선불금처럼 같은 고객이 반복해서 충전하는 서비스에
        적합합니다. 결제 진입점을 짧게 만들고, 승인 결과를 기존 충전 시스템과 연결합니다.
      </Notice>

      <section className="mt-5">
        <div className="grid grid-cols-2 gap-2.5">
          {targets.map(({ icon: Icon, title, body }) => (
            <Card key={title}>
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-ink-50 text-brand-700">
                <Icon size={17} strokeWidth={1.7} />
              </span>
              <p className="mt-2.5 text-[13.5px] font-bold text-ink-900">{title}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">{body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <SectionTitle title="도입 절차" description="상담 접수부터 운영 시작까지 네 단계입니다." />
        <ol className="space-y-2.5">
          {steps.map(({ icon: Icon, title, body }, i) => (
            <li key={title}>
              <Card>
                <div className="flex gap-3">
                  <span className="relative mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink-50 text-brand-700">
                    <Icon size={17} strokeWidth={1.7} />
                    <span className="absolute -top-1.5 -right-1.5 grid h-5 w-5 place-items-center rounded-full bg-brand-400 text-[10px] font-black text-ink-900">
                      {i + 1}
                    </span>
                  </span>
                  <div className="min-w-0">
                    <CardTitle>{title}</CardTitle>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">{body}</p>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-8">
        <SectionTitle title="미리 준비하면 좋은 것" description="상담 단계에서 모두 필요하지는 않습니다." />
        <Card>
          <ul className="space-y-2">
            {prepare.map((item) => (
              <li key={item} className="flex gap-2 text-[13px] leading-relaxed text-ink-600">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <section className="mt-8">
        <SectionTitle
          title="도입 상담 접수"
          description="담당자가 확인 후 회신드립니다. 접수 내용은 문의 관리에서 이어서 대화할 수 있습니다."
        />
        <SupportForm mode="onboarding" />
      </section>

      <section className="mt-8 space-y-2.5">
        <Card>
          <div className="flex gap-3">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink-50 text-brand-700">
              <ShieldCheck size={17} strokeWidth={1.7} />
            </span>
            <div>
              <CardTitle>안전 장치</CardTitle>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
                모든 요청에 고유 거래번호를 부여하고 중복 결제를 차단합니다. 결제 승인과 충전 반영을 분리해 기록하므로,
                반영 실패가 결제 결과를 바꾸지 않습니다.
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex gap-3">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink-50 text-brand-700">
              <ReceiptText size={17} strokeWidth={1.7} />
            </span>
            <div>
              <CardTitle>정산</CardTitle>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
                결제일 기준 영업일 수에 맞춰 자동 지급합니다. 수수료는 공급가액과 부가세를 나눠 기록하며, 가맹점
                관리자에서 원장과 지급 이력을 확인할 수 있습니다.
              </p>
            </div>
          </div>
        </Card>
      </section>
    </PublicShell>
  );
}

function BusinessAside() {
  return (
    <div className="sticky top-24 space-y-3">
      <Card>
        <div className="flex gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink-50 text-brand-700">
            <Building2 size={17} strokeWidth={1.7} />
          </span>
          <div>
            <CardTitle>이미 도입을 결정하셨다면</CardTitle>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
              상담 없이 바로 가맹점 가입을 신청할 수 있습니다. 심사 후 전용 결제 수신번호가 배정됩니다.
            </p>
          </div>
        </div>
        <LinkButton href="/merchant-apply" variant="secondary" size="md" className="mt-3 w-full">
          가맹점 가입 신청
        </LinkButton>
      </Card>
      <Card>
        <CardTitle>함께 보면 좋은 문서</CardTitle>
        <div className="mt-3 space-y-2">
          <LinkButton href="/how-it-works" variant="secondary" size="md" className="w-full">
            이용방법
          </LinkButton>
          <LinkButton href="/faq" variant="secondary" size="md" className="w-full">
            자주 묻는 질문
          </LinkButton>
          <LinkButton href="/support" variant="secondary" size="md" className="w-full">
            고객센터 문의
          </LinkButton>
        </div>
      </Card>
      <Card>
        <div className="flex gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink-50 text-brand-700">
            <Users size={17} strokeWidth={1.7} />
          </span>
          <div>
            <CardTitle>개인 이용자이신가요</CardTitle>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
              결제 취소·환불, 계좌 등록, 충전 반영 문제는 고객센터에서 접수해 주세요.
            </p>
          </div>
        </div>
      </Card>
      <Card>
        <div className="flex gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink-50 text-brand-700">
            <FileText size={17} strokeWidth={1.7} />
          </span>
          <div>
            <CardTitle>약관 확인</CardTitle>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
              이용약관, 개인정보처리방침, 전자금융거래약관에서 권리와 절차를 확인할 수 있습니다.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
