import Image from 'next/image';
import { cx } from '@/components/ui';

/** 공개 서브페이지와 콘솔 제목 옆에 쓰는 문자페이 브랜드 장식. */
export function MascotAccent({ className }: { seed: string; className?: string }) {
  return (
    <span
      className={cx('mascot-accent pointer-events-none select-none rounded-[28px] border border-white/60 bg-white/55 p-4 backdrop-blur-md', className)}
      aria-hidden="true"
    >
      <Image src="/munjapay-mark.svg" alt="" width={112} height={112} sizes="112px" />
    </span>
  );
}

/** PC 공개 화면의 앱 바깥 여백에 노출되는 문자결제 전용 배경. */
export function PublicMarginMascots({ home }: { home: boolean }) {
  return (
    <div className={cx('public-mascot-scene', home ? 'is-home' : 'is-subpage')} aria-hidden="true">
      <Image
        src={home ? '/assets/munjapay-margin-home-v1.png' : '/assets/munjapay-margin-sub-v1.png'}
        alt=""
        fill
        sizes="100vw"
        priority={home}
        className="object-cover"
      />
    </div>
  );
}

/** 관리자·서비스 콘솔 배경 모서리의 문자페이 브랜드 마크. */
export function ConsoleCornerMascot() {
  return (
    <span className="console-corner-mascot pointer-events-none select-none" aria-hidden="true">
      <Image src="/munjapay-mark.svg" alt="" width={170} height={170} sizes="170px" />
    </span>
  );
}
