/**
 * 후원샵 기본 배너.
 * 크리에이터가 배너를 설정하지 않으면 5종 중 하나가 크리에이터별로 고정 적용된다.
 * (매 방문마다 바뀌지 않도록 크리에이터 ID 해시로 결정한다)
 */

export const DEFAULT_BANNERS = [
  '/banners/munjapay-live-banner-01-v2.png',
  '/banners/munjapay-live-banner-02-v2.png',
  '/banners/munjapay-live-banner-03-v2.png',
  '/banners/munjapay-live-banner-04-v2.png',
  '/banners/munjapay-live-banner-05-v2.png',
] as const;

export function defaultBannerFor(creatorId: string): string {
  let h = 0;
  for (let i = 0; i < creatorId.length; i += 1) h = (h * 31 + creatorId.charCodeAt(i)) >>> 0;
  return DEFAULT_BANNERS[h % DEFAULT_BANNERS.length];
}
