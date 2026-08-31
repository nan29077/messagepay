import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight, BadgeCheck, BookOpen, Check, ChevronRight, CircleDollarSign,
  Clock3, Gamepad2, Landmark, MessageSquareText, RefreshCcw, ShieldCheck,
  ShoppingBag, Smartphone, WalletCards, Zap,
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
  { icon: MessageSquareText, title: '안내된 번호로 문자 전송', body: '서비스명과 충전할 금액을 문자로 보냅니다.' },
  { icon: Smartphone, title: '안내 링크에서 한 번 확인', body: '처음 한 번 결제수단을 등록하고, 결제 내용을 확인합니다.' },
  { icon: BadgeCheck, title: '결제와 포인트 충전 완료', body: '결제가 승인되면 연결된 서비스 잔액에 바로 반영됩니다.' },
];

const faqs = [
  ['앱을 꼭 설치해야 하나요?', '아니요. 기본 문자 앱과 안내 링크만으로 이용할 수 있습니다.'],
  ['처음부터 문자만 보내면 결제되나요?', '최초 이용 시에는 본인 확인과 결제수단 등록이 필요합니다. 이후에도 결제 전 금액과 대상을 확인할 수 있습니다.'],
  ['어떤 서비스가 문자페이를 도입할 수 있나요?', '게임 캐시, 멤버십 포인트, 콘텐츠 이용권처럼 선불 충전이 필요한 온라인·오프라인 서비스에 적용할 수 있습니다.'],
  ['결제 실패나 중복 요청은 어떻게 처리되나요?', '모든 요청에 고유 거래번호를 부여하고 중복 결제를 차단합니다. 처리 결과는 문자로 안내합니다.'],
];

export default function HomePage() {
  return (
    <PublicShell>
      <HeroSlider />

      <section className="mt-5 grid grid-cols-3 gap-2.5" aria-label="문자페이 핵심 장점">
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
        <p className="text-[11px] font-extrabold tracking-[0.18em] text-brand-700">HOW IT WORKS</p>
        <SectionTitle title="충전까지 딱 세 단계" description="처음 한 번만 등록하면 다음 결제가 훨씬 간단해집니다." />
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

      <section id="for-business" className="relative mt-12 scroll-mt-24 overflow-hidden rounded-[28px] border border-[#dbe4ee] p-5 sm:p-6">
        <Image src="/assets/munjapay-banner-business-v1.png" alt="" fill sizes="640px" className="scale-110 object-cover opacity-20 blur-[5px]" />
        <span className="absolute inset-0 bg-white/88" aria-hidden />
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

      <section className="relative mt-12 overflow-hidden rounded-[28px] bg-[#071426] px-5 py-6 text-white sm:px-7 sm:py-8">
        <Image src="/assets/munjapay-banner-secure-v1.png" alt="" fill sizes="640px" className="scale-110 object-cover opacity-30 blur-[3px]" />
        <span className="absolute inset-0 bg-[#071426]/62" aria-hidden />
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
        <Image src="/assets/munjapay-banner-fast-v1.png" alt="" fill sizes="640px" className="scale-110 object-cover opacity-28 blur-[4px]" />
        <span className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,20,38,.96),rgba(7,20,38,.7))]" aria-hidden />
        <div className="relative">
        <div className="flex items-center gap-2 text-[12px] font-extrabold"><CircleDollarSign size={17} strokeWidth={1.8} /> FOR YOUR SERVICE</div>
        <h2 className="mt-4 text-[27px] font-black leading-[1.2] tracking-[-0.05em]">고객의 충전 순간을<br />더 짧고 선명하게</h2>
        <p className="mt-3 max-w-[430px] text-[13px] leading-relaxed text-white/68">문자페이를 내 서비스에 연결하고 싶다면 필요한 충전 방식과 운영 환경을 알려주세요.</p>
        <LinkButton href="/support" variant="secondary" size="lg" className="mt-5 !border-[#b7f34a]/20 !bg-[#b7f34a] !text-[#071426] hover:!bg-[#d8ff88]">도입 상담 시작하기<ArrowRight size={16} strokeWidth={1.8} /></LinkButton>
        </div>
      </section>

      <div className="mt-5 flex items-center justify-center gap-5 text-[11px] font-semibold text-ink-400"><span className="flex items-center gap-1.5"><Clock3 size={13} /> 빠른 충전</span><span className="flex items-center gap-1.5"><WalletCards size={13} /> 간편 결제</span></div>
    </PublicShell>
  );
}
