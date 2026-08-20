import { redirect } from 'next/navigation';

/**
 * 자체 방송 화면은 방송·오버레이로 통합되었다.
 * 기존 링크 호환을 위해 리다이렉트만 남긴다.
 */
export default function StudioStreamPage() {
  redirect('/studio/overlay#stream');
}
