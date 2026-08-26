import Image from 'next/image';
import { cx } from '@/components/ui';

const MASCOTS = [
  '/stickers/donaido/cheer.webp',
  '/stickers/donaido/heart-hug.webp',
  '/stickers/donaido/gift-pop.webp',
  '/stickers/donaido/mic-dance.webp',
  '/stickers/donaido/thanks-bow.webp',
  '/stickers/donaido/message-fly-v1.png',
  '/stickers/donaido/coin-cloud-v1.png',
  '/stickers/donaido/heart-peek-v1.png',
] as const;

const MARGIN_MASCOTS = [
  { src: '/stickers/donaido/cheer.webp', position: 'mascot-pos-1' },
  { src: '/stickers/donaido/message-fly-v1.png', position: 'mascot-pos-2' },
  { src: '/stickers/donaido/mic-dance.webp', position: 'mascot-pos-3' },
  { src: '/stickers/donaido/heart-hug.webp', position: 'mascot-pos-4' },
  { src: '/stickers/donaido/coin-cloud-v1.png', position: 'mascot-pos-5' },
  { src: '/stickers/donaido/heart-peek-v1.png', position: 'mascot-pos-6' },
  { src: '/stickers/donaido/thanks-bow.webp', position: 'mascot-pos-7' },
] as const;

function mascotFor(value: string) {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return MASCOTS[hash % MASCOTS.length];
}

/** 공개 서브페이지와 콘솔 제목 옆에 쓰는 작은 장식용 마스코트. */
export function MascotAccent({
  seed,
  className,
}: {
  seed: string;
  className?: string;
}) {
  return (
    <span className={cx('mascot-accent pointer-events-none select-none', className)} aria-hidden="true">
      <Image src={mascotFor(seed)} alt="" width={112} height={112} sizes="112px" />
    </span>
  );
}

/**
 * PC 공개 화면의 앱 바깥 여백에 놓이는 마스코트 장면.
 * 메인은 작은 캐릭터를 양쪽 여백 여러 높이에 흩어 배치하고,
 * 서브페이지는 그중 세 캐릭터만 은은하게 노출한다.
 */
export function PublicMarginMascots({ home }: { home: boolean }) {
  const items = home ? MARGIN_MASCOTS : [MARGIN_MASCOTS[1], MARGIN_MASCOTS[4], MARGIN_MASCOTS[6]];

  return (
    <div className={cx('public-mascot-scene', home ? 'is-home' : 'is-subpage')} aria-hidden="true">
      {items.map((item, index) => (
        <span key={item.src} className={cx('public-mascot', item.position)}>
          <Image src={item.src} alt="" width={128} height={128} sizes="128px" priority={home && index < 2} />
        </span>
      ))}
      <span className="mascot-ambient mascot-ambient-one" />
      <span className="mascot-ambient mascot-ambient-two" />
      <span className="mascot-ambient mascot-ambient-three" />
    </div>
  );
}

/** 관리자·크리에이터 콘솔 배경 모서리에 은은하게 보이는 마스코트. */
export function ConsoleCornerMascot() {
  return (
    <span className="console-corner-mascot pointer-events-none select-none" aria-hidden="true">
      <Image src="/stickers/donaido/thanks-bow.webp" alt="" width={170} height={170} sizes="170px" />
    </span>
  );
}
