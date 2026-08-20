import * as React from 'react';
import { cx } from '@/components/ui';

/**
 * 가입 시 생성되는 무작위 ULID를 50종 캐릭터 중 하나에 안정적으로 매핑한다.
 * 별도 개인정보나 외부 이미지 URL 없이도 같은 계정은 항상 같은 캐릭터를 본다.
 */
export function avatarIndexFromSeed(seed: string) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % 50;
}

export function GeneratedAvatar({
  seed,
  name,
  className,
}: {
  seed: string;
  name?: string | null;
  className?: string;
}) {
  const index = avatarIndexFromSeed(seed || 'donaido');
  const localIndex = index % 25;
  const column = localIndex % 5;
  const row = Math.floor(localIndex / 5);
  const sheet = index < 25 ? '/avatars-donaido-a-v1.png' : '/avatars-donaido-b-v1.png';

  return (
    <span
      role="img"
      aria-label={`${name || '사용자'} 프로필 캐릭터`}
      className={cx(
        'inline-block shrink-0 overflow-hidden rounded-full bg-brand-50 bg-no-repeat shadow-[0_5px_14px_rgba(23,22,26,0.15)] ring-2 ring-white',
        className,
      )}
      style={{
        backgroundImage: `url(${sheet})`,
        backgroundSize: '500% 500%',
        backgroundPosition: `${column * 25}% ${row * 25}%`,
      }}
      data-avatar-index={index}
    />
  );
}
