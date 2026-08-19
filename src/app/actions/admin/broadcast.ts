'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/auth';
import type { AdminActionState } from '@/components/admin/state';
import { run, requiredId } from './shared';

/**
 * 유튜브 연동 / 스트림 키 운영 액션.
 * 토큰·스트림키 원문은 어떤 경로로도 화면에 반환하지 않는다.
 */

export async function disconnectYouTube(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  return run(async (admin) => {
    const creatorId = requiredId(fd, 'creatorId', '크리에이터');
    const before = await prisma.youTubeConnection.findUnique({
      where: { creatorId },
      select: { id: true, status: true, channelTitle: true, expiresAt: true },
    });
    if (!before) throw new Error('연결된 유튜브 채널이 없습니다.');
    if (before.status === 'REVOKED') throw new Error('이미 해제된 연결입니다.');

    await prisma.youTubeConnection.update({
      where: { creatorId },
      data: {
        status: 'REVOKED',
        // 저장된 토큰 암호문을 폐기해 재사용을 차단한다.
        accessTokenEnc: '',
        refreshTokenEnc: '',
        lastError: '관리자에 의해 연결이 강제 해제되었습니다.',
        lastCheckedAt: new Date(),
      },
    });
    await writeAudit({
      adminUserId: admin.id,
      action: 'YOUTUBE_DISCONNECT',
      targetType: 'YouTubeConnection',
      targetId: before.id,
      before: { status: before.status, channelTitle: before.channelTitle },
      after: { status: 'REVOKED', tokensPurged: true },
    });
    revalidatePath('/admin/youtube');
    revalidatePath(`/admin/creators/${creatorId}`);
    return '유튜브 연결을 해제하고 저장된 토큰을 폐기했습니다. 크리에이터가 다시 연결해야 합니다.';
  });
}

export async function revokeStreamKey(_prev: AdminActionState, fd: FormData): Promise<AdminActionState> {
  return run(async (admin) => {
    const keyId = requiredId(fd, 'keyId', '스트림 키');
    const before = await prisma.streamKey.findUnique({
      where: { id: keyId },
      select: { id: true, status: true, keyMasked: true, channelId: true },
    });
    if (!before) throw new Error('스트림 키를 찾을 수 없습니다.');
    if (before.status === 'REVOKED') throw new Error('이미 폐기된 키입니다.');

    await prisma.streamKey.update({
      where: { id: keyId },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    await writeAudit({
      adminUserId: admin.id,
      action: 'STREAM_KEY_REVOKE',
      targetType: 'StreamKey',
      targetId: keyId,
      before: { status: before.status, keyMasked: before.keyMasked },
      after: { status: 'REVOKED' },
    });
    revalidatePath('/admin/streams');
    return `스트림 키(${before.keyMasked})를 폐기했습니다. 진행 중인 송출이 즉시 끊길 수 있습니다.`;
  });
}
