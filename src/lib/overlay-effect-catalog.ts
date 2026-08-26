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
  'DONAIDO_CHEER',
  'DONAIDO_HEART_HUG',
  'DONAIDO_GIFT_POP',
  'DONAIDO_MIC_DANCE',
  'DONAIDO_THANKS_BOW',
] as const;

export type OverlayEffectValue = (typeof OVERLAY_EFFECT_VALUES)[number];

export interface CharacterStickerDefinition {
  value: Extract<OverlayEffectValue, `DONAIDO_${string}`>;
  label: string;
  description: string;
  image: string;
  animationClass: string;
}

/** 도네이도 전용 투명 배경 캐릭터 스티커. */
export const DONAIDO_CHARACTER_STICKERS: readonly CharacterStickerDefinition[] = [
  {
    value: 'DONAIDO_CHEER',
    label: '응원 토네이도',
    description: '응원봉을 흔들며 통통 튀어요',
    image: '/stickers/donaido/cheer.webp',
    animationClass: 'animate-sticker-cheer',
  },
  {
    value: 'DONAIDO_HEART_HUG',
    label: '하트 포옹',
    description: '큰 하트를 안고 두근거려요',
    image: '/stickers/donaido/heart-hug.webp',
    animationClass: 'animate-sticker-heart',
  },
  {
    value: 'DONAIDO_GIFT_POP',
    label: '선물 팡',
    description: '선물 상자에서 힘차게 등장해요',
    image: '/stickers/donaido/gift-pop.webp',
    animationClass: 'animate-sticker-gift',
  },
  {
    value: 'DONAIDO_MIC_DANCE',
    label: '마이크 댄스',
    description: '노래하며 좌우로 신나게 춤춰요',
    image: '/stickers/donaido/mic-dance.webp',
    animationClass: 'animate-sticker-dance',
  },
  {
    value: 'DONAIDO_THANKS_BOW',
    label: '감사 인사',
    description: '두 손을 모아 꾸벅 인사해요',
    image: '/stickers/donaido/thanks-bow.webp',
    animationClass: 'animate-sticker-bow',
  },
];

export function findCharacterSticker(effect: string): CharacterStickerDefinition | null {
  const normalized = effect.toUpperCase();
  return DONAIDO_CHARACTER_STICKERS.find((sticker) => sticker.value === normalized) ?? null;
}
