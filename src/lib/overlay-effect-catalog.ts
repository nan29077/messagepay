/**
 * 오버레이 효과 카탈로그.
 *
 * 서버 검증, 크리에이터 설정 화면, OBS 오버레이가 같은 값을 공유해야 한다.
 * 기존 파티클 값은 호환성을 위해 이름과 순서를 유지한다.
 */
export const OVERLAY_EFFECT_VALUES = [
  'NONE',
  'HEART',
  'STAR',
  'FIREWORK',
  'CONFETTI',
  'COIN',
  'MUNJAPAY_CHEER',
  'MUNJAPAY_HEART_HUG',
  'MUNJAPAY_GIFT_POP',
  'MUNJAPAY_MIC_DANCE',
  'MUNJAPAY_THANKS_BOW',
] as const;

export type OverlayEffectValue = (typeof OVERLAY_EFFECT_VALUES)[number];

export interface CharacterStickerDefinition {
  value: Extract<OverlayEffectValue, `MUNJAPAY_${string}`>;
  label: string;
  description: string;
  image: string;
  animationClass: string;
}

/** 문자페이 전용 투명 배경 캐릭터 스티커. */
export const MUNJAPAY_CHARACTER_STICKERS: readonly CharacterStickerDefinition[] = [
  {
    value: 'MUNJAPAY_CHEER',
    label: '응원 문자페이',
    description: '응원봉을 흔들며 통통 튀어요',
    image: '/stickers/munjapay/cheer.webp',
    animationClass: 'animate-sticker-cheer',
  },
  {
    value: 'MUNJAPAY_HEART_HUG',
    label: '하트 포옹',
    description: '큰 하트를 안고 두근거려요',
    image: '/stickers/munjapay/heart-hug.webp',
    animationClass: 'animate-sticker-heart',
  },
  {
    value: 'MUNJAPAY_GIFT_POP',
    label: '선물 팡',
    description: '선물 상자에서 힘차게 등장해요',
    image: '/stickers/munjapay/gift-pop.webp',
    animationClass: 'animate-sticker-gift',
  },
  {
    value: 'MUNJAPAY_MIC_DANCE',
    label: '마이크 댄스',
    description: '노래하며 좌우로 신나게 춤춰요',
    image: '/stickers/munjapay/mic-dance.webp',
    animationClass: 'animate-sticker-dance',
  },
  {
    value: 'MUNJAPAY_THANKS_BOW',
    label: '감사 인사',
    description: '두 손을 모아 꾸벅 인사해요',
    image: '/stickers/munjapay/thanks-bow.webp',
    animationClass: 'animate-sticker-bow',
  },
];

export function findCharacterSticker(effect: string): CharacterStickerDefinition | null {
  const normalized = effect.toUpperCase();
  return MUNJAPAY_CHARACTER_STICKERS.find((sticker) => sticker.value === normalized) ?? null;
}
