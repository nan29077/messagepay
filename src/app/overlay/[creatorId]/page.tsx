import type { Metadata } from 'next';
import { prisma } from '@/server/db';
import { safeEqual, tokenHash } from '@/lib/crypto';
import { OverlayClient } from '@/components/overlay/overlay-client';

/**
 * OBS / PRISM 브라우저 소스 오버레이.
 *  - 토큰이 없거나 틀리면 아무 정보도 노출하지 않고 거절한다.
 *  - 검색엔진 색인을 차단한다.
 *  - 배경은 완전 투명이어야 한다.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '도네이도 오버레이',
  robots: { index: false, follow: false },
};

type Search = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? '';
  return v ?? '';
}

export default async function OverlayPage({
  params,
  searchParams,
}: {
  params: Promise<{ creatorId: string }>;
  searchParams: Promise<Search>;
}) {
  const { creatorId } = await params;
  const sp = await searchParams;
  const token = one(sp.token);
  const debug = one(sp.debug) === '1';

  const setting = await prisma.overlaySetting.findUnique({ where: { creatorId } });
  const authorized = Boolean(setting && token && safeEqual(setting.tokenHash, tokenHash(token)));

  if (!authorized) {
    return (
      <div className="grid h-screen w-screen place-items-center bg-transparent">
        <div className="rounded-2xl bg-ink-900/85 px-5 py-4 text-center">
          <p className="text-[14px] font-bold text-white">접근 권한이 없습니다 (401)</p>
          <p className="mt-1 text-[12px] text-white/70">오버레이 주소와 토큰을 다시 확인해 주세요.</p>
        </div>
      </div>
    );
  }

  if (!setting!.enabled) {
    // 오버레이가 꺼져 있으면 아무것도 표시하지 않는다(방송 화면 보호).
    return <div className="h-screen w-screen bg-transparent" />;
  }

  return (
    <OverlayClient
      creatorId={creatorId}
      token={token}
      position={setting!.position}
      defaultDurationMs={setting!.durationMs}
      maxMessageLen={setting!.maxMessageLen}
      debug={debug}
    />
  );
}
