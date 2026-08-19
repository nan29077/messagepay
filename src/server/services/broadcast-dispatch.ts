import { prisma } from '@/server/db';
import { kv } from '@/server/redis';
import { newId } from '@/lib/id';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { kstDateKey } from '@/lib/datetime';
import { getYouTubeAdapter, formatChatMessage } from '@/server/adapters/youtube';
import { buildTtsText } from '@/server/adapters/tts';
import { publishOverlayEvent, type OverlayEventPayload } from './overlay-bus';
import { decrypt, encrypt } from '@/lib/crypto';

/**
 * 결제 성공 건의 방송 전송.
 *
 * 원칙
 *  - 결제 성공 이후에만 호출된다.
 *  - 유튜브 전송 실패가 결제 결과를 바꾸지 않는다.
 *  - 오버레이/유튜브/TTS 각각의 결과를 따로 기록한다.
 */

export interface DispatchResult {
  overlay: boolean;
  youtube: boolean;
  youtubeSkippedReason?: string;
}

/** 유튜브 일일 할당량 가드. 실측 전까지 보수적으로 막는다. */
async function reserveYouTubeQuota(cost: number): Promise<boolean> {
  const key = `yt:quota:${kstDateKey()}`;
  const used = Number((await kv.get(key)) ?? 0);
  if (used + cost > env.youtube.dailyQuota) return false;
  await kv.set(key, String(used + cost), 60 * 60 * 30);
  return true;
}

export async function getYouTubeQuotaUsage() {
  const key = `yt:quota:${kstDateKey()}`;
  const used = Number((await kv.get(key)) ?? 0);
  return {
    used,
    total: env.youtube.dailyQuota,
    insertCost: env.youtube.insertQuotaCost,
    remainingMessages: Math.max(0, Math.floor((env.youtube.dailyQuota - used) / env.youtube.insertQuotaCost)),
  };
}

export async function dispatchBroadcast(donationId: string): Promise<DispatchResult> {
  const donation = await prisma.donation.findUnique({
    where: { id: donationId },
    include: { creator: { include: { overlaySetting: true, ttsSetting: true, youtubeConnection: true } } },
  });
  if (!donation) return { overlay: false, youtube: false };

  await prisma.donation.update({ where: { id: donationId }, data: { status: 'BROADCAST_PENDING' } });

  const overlayOk = await sendOverlay(donationId);
  const yt = await sendYouTube(donationId);

  const allOk = overlayOk && yt.ok;
  await prisma.donation.update({
    where: { id: donationId },
    data: {
      status: allOk ? 'BROADCASTED' : 'PARTIAL_DELIVERY_FAILED',
      broadcastedAt: new Date(),
      statusReason: allOk ? null : `overlay=${overlayOk} youtube=${yt.ok}${yt.reason ? ` (${yt.reason})` : ''}`,
    },
  });
  await prisma.donationStatusLog.create({
    data: {
      id: newId(), donationId, fromStatus: 'BROADCAST_PENDING',
      toStatus: allOk ? 'BROADCASTED' : 'PARTIAL_DELIVERY_FAILED', actor: 'system',
    },
  });

  return { overlay: overlayOk, youtube: yt.ok, youtubeSkippedReason: yt.reason };
}

export async function buildOverlayPayload(donationId: string, isTest = false): Promise<OverlayEventPayload | null> {
  const donation = await prisma.donation.findUnique({
    where: { id: donationId },
    include: { creator: { include: { overlaySetting: true, ttsSetting: true } } },
  });
  if (!donation) return null;

  const overlay = donation.creator.overlaySetting;
  const tts = donation.creator.ttsSetting;
  const donorName = overlay?.anonymize || donation.anonymous ? '익명의 후원자' : donation.displayName;
  const message = overlay?.showMessage === false ? '' : donation.message;

  const ttsEnabled = Boolean(tts?.enabled) && donation.amount >= (tts?.minAmount ?? 0n);

  return {
    eventId: newId(),
    creatorId: donation.creatorId,
    donationId: donation.id,
    donorName,
    amount: overlay?.showAmount === false ? '' : donation.amount.toString(),
    message,
    sticker: overlay?.stickerSet ?? 'DEFAULT',
    tts: ttsEnabled
      ? {
          enabled: true,
          text: buildTtsText({
            donorName,
            amount: donation.amount,
            message,
            readAmount: tts?.readAmount ?? true,
            readName: tts?.readName ?? true,
            maxChars: tts?.maxChars ?? 80,
          }),
          voice: tts?.voice ?? 'ko-KR-Standard-A',
          speed: tts?.speed ?? 1,
          volume: tts?.volume ?? 1,
        }
      : null,
    durationMs: overlay?.durationMs ?? 7000,
    occurredAt: new Date().toISOString(),
    isTest,
  };
}

async function sendOverlay(donationId: string): Promise<boolean> {
  const payload = await buildOverlayPayload(donationId);
  if (!payload) return false;

  const setting = await prisma.overlaySetting.findUnique({ where: { creatorId: payload.creatorId } });
  if (setting && !setting.enabled) {
    await prisma.donation.update({ where: { id: donationId }, data: { overlayStatus: 'SKIPPED' } });
    return true;
  }

  await prisma.overlayEvent.create({
    data: {
      id: payload.eventId,
      creatorId: payload.creatorId,
      donationId,
      payload: payload as unknown as object,
      status: 'SENT',
      playedAt: new Date(),
    },
  });
  publishOverlayEvent(payload);
  await prisma.donation.update({ where: { id: donationId }, data: { overlayStatus: 'SENT' } });
  return true;
}

async function sendYouTube(donationId: string): Promise<{ ok: boolean; reason?: string }> {
  const donation = await prisma.donation.findUnique({
    where: { id: donationId },
    include: { creator: { include: { youtubeConnection: true } } },
  });
  if (!donation) return { ok: false, reason: 'NOT_FOUND' };

  const conn = donation.creator.youtubeConnection;
  const delivery = await prisma.youTubeChatDelivery.create({
    data: { id: newId(), donationId, status: 'PENDING' },
  });

  const skip = async (reason: string) => {
    await prisma.youTubeChatDelivery.update({
      where: { id: delivery.id },
      data: { status: 'SKIPPED', errorCode: reason },
    });
    await prisma.donation.update({ where: { id: donationId }, data: { youtubeStatus: 'SKIPPED' } });
    return { ok: true, reason };
  };

  if (!conn || conn.status !== 'CONNECTED') return skip('NO_CONNECTION');

  const adapter = getYouTubeAdapter();

  // 액세스 토큰 만료 시 갱신
  let accessToken = decrypt(conn.accessTokenEnc);
  if (conn.expiresAt.getTime() < Date.now() + 60_000) {
    const refreshed = await adapter.refresh(decrypt(conn.refreshTokenEnc));
    if (!refreshed.ok || !refreshed.data) {
      await prisma.youTubeConnection.update({
        where: { id: conn.id },
        data: { status: 'EXPIRED', lastError: refreshed.message ?? 'refresh 실패' },
      });
      return skip('TOKEN_REFRESH_FAILED');
    }
    accessToken = refreshed.data.accessToken;
    await prisma.youTubeConnection.update({
      where: { id: conn.id },
      data: {
        accessTokenEnc: encrypt(refreshed.data.accessToken),
        expiresAt: refreshed.data.expiresAt,
        status: 'CONNECTED',
        lastError: null,
      },
    });
  }

  const live = await adapter.findActiveBroadcast(accessToken);
  if (!live.ok || !live.data || !live.data.liveChatId) return skip('NO_ACTIVE_BROADCAST');

  const broadcast = await prisma.youTubeBroadcast.upsert({
    where: { creatorId_broadcastId: { creatorId: donation.creatorId, broadcastId: live.data.broadcastId } },
    create: {
      id: newId(),
      creatorId: donation.creatorId,
      broadcastId: live.data.broadcastId,
      liveChatId: live.data.liveChatId,
      title: live.data.title,
      lifeCycle: live.data.lifeCycleStatus,
      chatEnabled: live.data.chatEnabled,
      startedAt: live.data.startedAt ?? null,
    },
    update: { liveChatId: live.data.liveChatId, lifeCycle: live.data.lifeCycleStatus },
  });

  if (!(await reserveYouTubeQuota(env.youtube.insertQuotaCost))) {
    await prisma.youTubeChatDelivery.update({
      where: { id: delivery.id },
      data: { status: 'FAILED', broadcastId: broadcast.id, errorCode: 'QUOTA_EXCEEDED', errorMessage: '일일 할당량 초과' },
    });
    await prisma.donation.update({ where: { id: donationId }, data: { youtubeStatus: 'FAILED' } });
    logger.warn('유튜브 할당량 초과로 채팅 전송 보류', { donationId });
    return { ok: false, reason: 'QUOTA_EXCEEDED' };
  }

  const text = formatChatMessage({
    donorName: donation.displayName,
    amount: donation.amount,
    message: donation.message,
  });

  const res = await adapter.insertChatMessage(accessToken, live.data.liveChatId, text);
  await prisma.youTubeChatDelivery.update({
    where: { id: delivery.id },
    data: {
      status: res.ok ? 'SENT' : 'FAILED',
      broadcastId: broadcast.id,
      liveChatId: live.data.liveChatId,
      providerMessageId: res.data?.messageId ?? null,
      quotaUnits: res.data?.quotaUnits ?? env.youtube.insertQuotaCost,
      attempts: { increment: 1 },
      errorCode: res.ok ? null : res.code ?? 'ERROR',
      errorMessage: res.ok ? null : res.message ?? null,
      sentAt: res.ok ? new Date() : null,
    },
  });
  await prisma.donation.update({
    where: { id: donationId },
    data: { youtubeStatus: res.ok ? 'SENT' : 'FAILED' },
  });

  return res.ok ? { ok: true } : { ok: false, reason: res.code ?? 'SEND_FAILED' };
}

/** 테스트 후원: 실제 결제/정산에 반영하지 않고 화면과 TTS 만 확인한다. */
export async function sendTestOverlay(creatorId: string, input: { donorName: string; amount: bigint; message: string }) {
  const creator = await prisma.creatorProfile.findUnique({
    where: { id: creatorId },
    include: { overlaySetting: true, ttsSetting: true },
  });
  if (!creator) throw new Error('크리에이터를 찾을 수 없습니다.');

  const tts = creator.ttsSetting;
  const payload: OverlayEventPayload = {
    eventId: newId(),
    creatorId,
    donationId: null,
    donorName: input.donorName,
    amount: input.amount.toString(),
    message: input.message,
    sticker: creator.overlaySetting?.stickerSet ?? 'DEFAULT',
    tts: tts?.enabled
      ? {
          enabled: true,
          text: buildTtsText({
            donorName: input.donorName,
            amount: input.amount,
            message: input.message,
            readAmount: tts.readAmount,
            readName: tts.readName,
            maxChars: tts.maxChars,
          }),
          voice: tts.voice,
          speed: tts.speed,
          volume: tts.volume,
        }
      : null,
    durationMs: creator.overlaySetting?.durationMs ?? 7000,
    occurredAt: new Date().toISOString(),
    isTest: true,
  };

  await prisma.overlayEvent.create({
    data: {
      id: payload.eventId, creatorId, payload: payload as unknown as object,
      status: 'SENT', isTest: true, playedAt: new Date(),
    },
  });
  publishOverlayEvent(payload);
  return payload;
}
