import Image from 'next/image';
import {
  ArrowRight, BadgeCheck, BookOpen, Building2, Cable, Check, ChevronRight,
  CircleDollarSign, Clock3, Coins, Gamepad2, Gauge, Headphones, KeyRound,
  Landmark, LayoutDashboard, MessageSquareText, ReceiptText, RefreshCcw,
  Send, Settings2, ShieldCheck, ShoppingBag, Smartphone, Sparkles,
  UserRoundCheck, WalletCards, Zap,
} from 'lucide-react';
import { PublicShell } from '@/components/layout/public-shell';
import { HeroSlider } from '@/components/public/hero-slider';
import { Card, LinkButton, SectionTitle } from '@/components/ui';

const serviceTypes = [
  { icon: Gamepad2, title: '게임 · 앱', body: '캐시, 코인, 이용권처럼 자주 충전하는 디지털 포인트' },
  { icon: ShoppingBag, title: '커머스 · 멤버십', body: '선불금, 마일리지, 멤버십 잔액을 빠르게 충전' },
  { icon: BookOpen, title: '교육 · 콘텐츠', body: '수강권, 열람권, 콘텐츠 크레딧을 필요한 순간 바로 결제' },
  { icon: Landmark, title: '생활 서비스', body: '주차, 세탁, 교통 등 반복 이용 서비스의 간편 충전' },
];

const steps = [
  { icon: MessageSquareText, title: '안내된 번호로 문자 전송', body: '고객이 가맹 서비스의 전용 번호로 충전 요청 문자를 보냅니다.' },
  { icon: UserRoundCheck, title: '최초 1회 본인·계좌 등록', body: '안내 링크에서 본인을 확인하고 결제수단과 이용 동의를 등록합니다.' },
  { icon: Smartphone, title: '대상과 금액을 확인하고 승인', body: '결제 전에 서비스, 충전 상품, 최종 금액을 다시 확인합니다.' },
  { icon: BadgeCheck, title: '결제 완료와 서비스 반영', body: '승인 결과가 가맹 서비스에 전달되고 포인트 또는 이용권이 반영됩니다.' },
];

const businessBenefits = [
  { icon: Zap, title: '짧아지는 결제 동선', body: '앱 메뉴를 여러 번 이동하지 않고 문자에서 결제 확인까지 자연스럽게 이어집니다.' },
  { icon: Settings2, title: '상품과 금액을 유연하게', body: '정액 충전 상품과 서비스별 정책을 운영 환경에 맞춰 구성할 수 있습니다.' },
  { icon: LayoutDashboard, title: '한 화면에서 운영', body: '결제 요청, 승인, 실패, 환불과 충전 반영 상태를 거래번호 기준으로 확인합니다.' },
  { icon: Cable, title: 'API로 서비스 연결', body: '결제 완료 결과를 파트너 API와 콜백으로 연결해 포인트 지급 흐름을 자동화합니다.' },
];

const integrationSteps = [
  ['01', '서비스 상담', '충전 상품, 고객 흐름, 예상 거래량과 운영 정책을 함께 정리합니다.'],
  ['02', '결제 구조 설계', '전용 수신번호와 상품 금액, 한도, 환불 및 정산 기준을 설정합니다.'],
  ['03', 'API·콜백 연동', '결제 상태 조회와 완료 알림을 기존 포인트 시스템에 연결합니다.'],
  ['04', '테스트 후 오픈', '중복 요청과 실패·환불 시나리오까지 확인한 뒤 실제 서비스를 시작합니다.'],
];

const operationFeatures = [
  { icon: ReceiptText, title: '거래 상태 추적', body: '접수부터 승인·실패·환불까지 거래번호로 이어서 확인' },
  { icon: Gauge, title: '한도와 위험 관리', body: '일별 한도와 반복 요청 제한으로 비정상 결제를 사전에 제어' },
  { icon: Coins, title: '정산 내역 관리', body: '결제 금액과 수수료, 환불, 지급 상태를 분리해 투명하게 관리' },
  { icon: Headphones, title: '문의 대응 연결', body: '고객 문의에 거래번호를 연결해 필요한 결제 정보를 빠르게 확인' },
];

const faqs = [
  ['앱을 꼭 설치해야 하나요?', '아니요. 기본 문자 앱과 안내 링크만으로 이용할 수 있습니다.'],
  ['처음부터 문자만 보내면 결제되나요?', '최초 이용 시에는 본인 확인과 결제수단 등록이 필요합니다. 이후에도 결제 전 금액과 대상을 확인할 수 있습니다.'],
  ['어떤 서비스가 메시지페이를 도입할 수 있나요?', '게임 캐시, 멤버십 포인트, 콘텐츠 이용권처럼 선불 충전이 필요한 온라인·오프라인 서비스에 적용할 수 있습니다.'],
  ['결제 실패나 중복 요청은 어떻게 처리되나요?', '모든 요청에 고유 거래번호를 부여하고 중복 결제를 차단합니다. 처리 결과는 문자로 안내합니다.'],
  ['기존 포인트 시스템과 연결할 수 있나요?', '네. 도입 협의 후 파트너 API와 결제 완료 콜백을 이용해 기존 충전·포인트 지급 시스템과 연결할 수 있습니다.'],
  ['가맹점은 무엇을 관리할 수 있나요?', '충전 상품, 거래 상태, 환불 요청, 정산 내역과 운영 설정을 가맹점 전용 화면에서 확인하고 관리할 수 있습니다.'],
];

export default function HomePage() {
  return (
    <PublicShell>
      <HeroSlider />

      <section className="mt-5 grid grid-cols-3 gap-2.5" aria-label="메시지페이 핵심 장점">
        {[
          { icon: Zap, title: '빠르게', body: '문자 한 통' },
          { icon: ShieldCheck, title: '안전하게', body: '결제 전 확인' },
          { icon: RefreshCcw, title: '간편하게', body: '반복 충전' },
        ].map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-[20px] border border-[#dbe4ee] bg-white px-3 py-4 text-center shadow-[0_12px_34px_rgba(7,20,38,.06)]">
            <span className="mx-auto grid h-9 w-9 place-items-center rounded-[12px] bg-[#effbd7] text-[#486c00]"><Icon size={17} strokeWidth={1.8} /></span>
            <p className="mt-2 text-[13px] font-extrabold text-ink-900">{title}</p><p className="mt-0.5 text-[11px] text-ink-400">{body}</p>
          </div>
        ))}
      </section>

      <section className="mt-12">
        <p className="text-[11px] font-extrabold tracking-[0.18em] text-brand-700">ABOUT MESSAGEPAY</p>
        <SectionTitle
          title="문자가 결제의 가장 짧은 입구가 됩니다"
          description="MessagePay는 고객이 익숙한 문자에서 결제를 시작하고, 확인과 승인 이후 서비스 충전까지 연결하는 문자 기반 간편결제 솔루션입니다."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="relative overflow-hidden !border-[#dbe4ee] text-white" style={{ background: '#071426' }}>
            <span className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-[#b7f34a]/10 blur-2xl" aria-hidden />
            <span className="grid h-11 w-11 place-items-center rounded-[15px] bg-[#b7f34a] text-[#071426]"><Send size={20} strokeWidth={1.8} /></span>
            <p className="mt-4 text-[11px] font-extrabold tracking-[0.14em] text-[#b7f34a]">FOR CUSTOMERS</p>
            <h2 className="mt-1 text-[19px] font-black tracking-[-0.035em]">고객에게는 더 익숙하게</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-white/62">새 앱을 찾고 복잡한 메뉴를 배우는 대신, 평소 사용하는 문자로 결제를 시작합니다. 최종 승인 전 대상과 금액을 확인할 수 있어 간편함과 안심을 함께 챙깁니다.</p>
          </Card>
          <Card className="relative overflow-hidden !border-[#dbe4ee] !bg-white">
            <span className="grid h-11 w-11 place-items-center rounded-[15px] bg-[#effbd7] text-[#486c00]"><Building2 size={20} strokeWidth={1.8} /></span>
            <p className="mt-4 text-[11px] font-extrabold tracking-[0.14em] text-brand-700">FOR BUSINESS</p>
            <h2 className="mt-1 text-[19px] font-black tracking-[-0.035em] text-ink-900">서비스에는 더 자연스럽게</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-500">게임 캐시, 멤버십 포인트, 콘텐츠 이용권처럼 반복 충전이 중요한 서비스에 짧은 결제 진입점을 더하고, 승인 결과를 기존 시스템과 연결합니다.</p>
          </Card>
        </div>
        <div className="mt-3 rounded-[18px] border border-[#dbe4ee] bg-white px-4 py-3.5">
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[12px] font-bold text-ink-500">
            <span className="flex items-center gap-1.5"><MessageSquareText size={15} className="text-brand-700" />문자 요청</span>
            <ArrowRight size={13} className="text-ink-300" />
            <span className="flex items-center gap-1.5"><KeyRound size={15} className="text-brand-700" />본인 확인</span>
            <ArrowRight size={13} className="text-ink-300" />
            <span className="flex items-center gap-1.5"><WalletCards size={15} className="text-brand-700" />결제 승인</span>
            <ArrowRight size={13} className="text-ink-300" />
            <span className="flex items-center gap-1.5"><Sparkles size={15} className="text-brand-700" />충전 반영</span>
          </div>
        </div>
      </section>

      <section className="mt-12">
        <p className="text-[11px] font-extrabold tracking-[0.18em] text-brand-700">HOW IT WORKS</p>
        <SectionTitle title="문자에서 충전까지 이어지는 과정" description="최초 등록 이후에도 결제 전 확인 단계를 거쳐 요청 내용을 안전하게 처리합니다." />
        <div className="relative space-y-3">
          <span className="absolute bottom-8 left-[25px] top-8 w-px bg-brand-200" aria-hidden />
          {steps.map(({ icon: Icon, title, body }, index) => (
            <Card key={title} className="relative flex items-start gap-4 !border-[#dbe4ee] !bg-white">
              <span className="relative z-10 grid h-12 w-12 shrink-0 place-items-center rounded-[16px] bg-[#071426] text-[#b7f34a] shadow-[0_8px_20px_rgba(7,20,38,.18)]"><Icon size={20} strokeWidth={1.7} /><span className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-[#b7f34a] text-[10px] font-black text-[#071426]">{index + 1}</span></span>
              <div className="pt-0.5"><p className="text-[15px] font-extrabold text-ink-900">{title}</p><p className="mt-1 text-[13px] leading-relaxed text-ink-500">{body}</p></div>
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <p className="text-[11px] font-extrabold tracking-[0.18em] text-brand-700">WHY MESSAGEPAY</p>
        <SectionTitle title="결제 경험과 운영 효율을 함께" description="고객에게는 짧은 결제 흐름을, 운영팀에는 추적 가능한 관리 구조를 제공합니다." />
        <div className="grid grid-cols-2 gap-2.5">
          {businessBenefits.map(({ icon: Icon, title, body }) => (
            <Card key={title} className="h-full !border-[#dbe4ee] !bg-white">
              <span className="grid h-10 w-10 place-items-center rounded-[14px] bg-[#071426] text-[#b7f34a]"><Icon size={18} strokeWidth={1.7} /></span>
              <p className="mt-3 text-[14px] font-extrabold text-ink-900">{title}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">{body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section id="for-business" className="relative mt-12 scroll-mt-24 overflow-hidden rounded-[28px] border border-[#dbe4ee] p-5 sm:p-6">
        <Image src="/assets/messagepay-banner-business-v1.png" alt="" fill sizes="640px" className="scale-110 object-cover opacity-20 blur-[5px]" />
        <span className="absolute inset-0 bg-white/88" aria-hidden />
        <Image src="/assets/messagepay-mascot-v1.png" alt="" width={210} height={210} sizes="180px" className="absolute -bottom-8 -right-7 h-auto w-[180px] rotate-6 object-contain opacity-[0.16]" />
        <div className="relative">
        <p className="text-[11px] font-extrabold tracking-[0.18em] text-brand-700">BUILT FOR BALANCE</p>
        <SectionTitle title="충전이 필요한 서비스라면" description="고객이 포인트를 쓰는 순간, 결제 경험도 서비스의 일부가 됩니다." />
        <div className="grid grid-cols-2 gap-2.5">
          {serviceTypes.map(({ icon: Icon, title, body }) => (
            <Card key={title} className="h-full !border-[#dbe4ee] !bg-white"><span className="grid h-10 w-10 place-items-center rounded-[14px] bg-[#effbd7] text-[#486c00]"><Icon size={19} strokeWidth={1.7} /></span><p className="mt-3 text-[14px] font-extrabold text-ink-900">{title}</p><p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">{body}</p></Card>
          ))}
        </div>
        </div>
      </section>

      <section className="mt-12 overflow-hidden rounded-[28px] border border-[#dbe4ee] bg-white p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold tracking-[0.18em] text-brand-700">INTEGRATION</p>
            <h2 className="mt-2 text-[22px] font-black tracking-[-0.04em] text-ink-900">우리 서비스에 맞게 연결합니다</h2>
            <p className="mt-2 max-w-[500px] text-[13px] leading-relaxed text-ink-500">단순 결제창 추가가 아니라 충전 상품과 운영 정책, 기존 포인트 지급 구조를 함께 확인해 도입 흐름을 설계합니다.</p>
          </div>
          <span className="hidden h-12 w-12 shrink-0 place-items-center rounded-[16px] bg-[#effbd7] text-[#486c00] sm:grid"><Cable size={22} strokeWidth={1.7} /></span>
        </div>
        <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
          {integrationSteps.map(([number, title, body]) => (
            <div key={number} className="rounded-[18px] border border-[#e3eaf1] bg-[#f7fafb] p-4">
              <div className="flex items-center gap-2"><span className="text-[11px] font-black text-brand-700">{number}</span><span className="h-px flex-1 bg-[#dbe4ee]" /></div>
              <p className="mt-3 text-[14px] font-extrabold text-ink-900">{title}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">{body}</p>
            </div>
          ))}
        </div>
        <LinkButton href="/support?intent=onboarding" variant="secondary" size="md" className="mt-4">도입 방식 상담하기<ArrowRight size={15} strokeWidth={1.8} /></LinkButton>
      </section>

      <section className="mt-12">
        <p className="text-[11px] font-extrabold tracking-[0.18em] text-brand-700">OPERATIONS</p>
        <SectionTitle title="결제 이후의 운영까지 살펴봅니다" description="거래가 완료된 뒤 필요한 조회, 위험 관리, 정산과 고객 문의 대응을 하나의 흐름으로 관리합니다." />
        <div className="space-y-2.5">
          {operationFeatures.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex items-center gap-3 rounded-[18px] border border-[#dbe4ee] bg-white p-4 shadow-[0_8px_24px_rgba(7,20,38,.04)]">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] bg-[#effbd7] text-[#486c00]"><Icon size={18} strokeWidth={1.7} /></span>
              <div><p className="text-[14px] font-extrabold text-ink-900">{title}</p><p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-500">{body}</p></div>
            </div>
          ))}
        </div>
      </section>

      <section className="relative mt-12 overflow-hidden rounded-[28px] bg-[#071426] px-5 py-6 text-white sm:px-7 sm:py-8">
        <Image src="/assets/messagepay-banner-secure-v1.png" alt="" fill sizes="640px" className="scale-110 object-cover opacity-30 blur-[3px]" />
        <span className="absolute inset-0 bg-[#071426]/62" aria-hidden />
        <Image src="/assets/messagepay-mascot-v1.png" alt="" width={220} height={220} sizes="190px" className="absolute -bottom-10 -right-7 h-auto w-[190px] -rotate-6 object-contain opacity-[0.28]" />
        <div className="relative">
        <div className="flex items-start gap-4"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-[16px] bg-[#b7f34a] text-[#071426]"><ShieldCheck size={23} strokeWidth={1.8} /></span><div><p className="text-[11px] font-bold tracking-[0.16em] text-[#b7f34a]">PAYMENT WITH CONFIDENCE</p><h2 className="mt-2 text-[23px] font-black tracking-[-0.04em]">간편함보다 중요한 건 안전함이니까</h2></div></div>
        <div className="mt-6 grid grid-cols-2 gap-x-5 gap-y-4">
          {[
            ['결제 전 금액 확인', '대상과 금액을 확인한 뒤 승인'], ['중복 결제 차단', '한 요청이 여러 번 처리되지 않게 보호'],
            ['거래번호 추적', '모든 결제 결과를 문자로 안내'], ['이용 한도 관리', '과도한 반복 결제를 사전에 방지'],
          ].map(([title, body]) => <div key={title}><p className="flex items-center gap-1.5 text-[13px] font-extrabold"><Check size={15} className="text-[#b7f34a]" strokeWidth={2.2} />{title}</p><p className="mt-1 text-[11.5px] leading-relaxed text-white/52">{body}</p></div>)}
        </div>
        </div>
      </section>

      <section className="mt-12">
        <SectionTitle title="자주 묻는 질문" />
        <div className="space-y-2.5">
          {faqs.map(([question, answer]) => (
            <details key={question} className="group rounded-[18px] border border-[#dbe4ee] bg-white px-4 py-4 shadow-[0_8px_28px_rgba(7,20,38,.045)]"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[14px] font-extrabold text-ink-900">{question}<ChevronRight size={17} strokeWidth={1.8} className="shrink-0 text-ink-300 transition-transform group-open:rotate-90" /></summary><p className="mt-3 border-t border-ink-100 pt-3 text-[13px] leading-relaxed text-ink-500">{answer}</p></details>
          ))}
        </div>
      </section>

      <section className="relative mt-12 overflow-hidden rounded-[28px] bg-[#071426] p-6 text-white sm:p-8">
        <Image src="/assets/messagepay-banner-fast-v2.png" alt="" fill sizes="640px" className="scale-110 object-cover opacity-34 blur-[4px]" />
        <span className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,20,38,.96),rgba(7,20,38,.7))]" aria-hidden />
        <div className="relative">
        <div className="flex items-center gap-2 text-[12px] font-extrabold"><CircleDollarSign size={17} strokeWidth={1.8} /> FOR YOUR SERVICE</div>
        <h2 className="mt-4 text-[27px] font-black leading-[1.2] tracking-[-0.05em]">고객의 충전 순간을<br />더 짧고 선명하게</h2>
        <p className="mt-3 max-w-[430px] text-[13px] leading-relaxed text-white/68">메시지페이를 내 서비스에 연결하고 싶다면 필요한 충전 방식과 운영 환경을 알려주세요.</p>
        <LinkButton href="/support?intent=onboarding" variant="secondary" size="lg" className="mt-5 !border-[#b7f34a]/20 !bg-[#b7f34a] !text-[#071426] hover:!bg-[#d8ff88]">도입 상담 시작하기<ArrowRight size={16} strokeWidth={1.8} /></LinkButton>
        </div>
      </section>

      <div className="mt-5 flex items-center justify-center gap-5 text-[11px] font-semibold text-ink-400"><span className="flex items-center gap-1.5"><Clock3 size={13} /> 빠른 충전</span><span className="flex items-center gap-1.5"><WalletCards size={13} /> 간편 결제</span></div>
    </PublicShell>
  );
}
