import { prisma } from '@/server/db';
import { kv } from '@/server/redis';
import { newId } from '@/lib/id';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { kstDateKey } from '@/lib/datetime';
import { getYouTubeAdapter, formatChatMessage } from '@/server/adapters/youtube';
import { buildTtsText } from '@/server/adapters/tts';
import { publishOverlayEvent, type OverlayEventPayload } from './overlay-bus';
import { resolveOverlayTier, type ResolvedTier } from './overlay-tiers';
import { decrypt, encrypt, phoneTail4 } from '@/lib/crypto';
import { normalizeTtsProvider } from './tts/naver';

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

  // 각 송출은 독립이다. 한쪽이 예외를 던져도 나머지를 계속 시도하고,
  // 아래 상태 확정(BROADCASTED / PARTIAL_DELIVERY_FAILED)은 **반드시** 수행한다.
  // 예외가 그대로 새어 나가면 후원이 BROADCAST_PENDING 에 영구히 고착되어
  // 결제는 끝났는데 정산 대기로 넘어가지 않는다.
  let overlayOk = false;
  try {
    overlayOk = await sendOverlay(donationId);
  } catch (e) {
    logger.error('오버레이 송출 오류 (결제는 정상 완료)', { donationId, message: (e as Error).message });
    await prisma.donation
      .update({ where: { id: donationId }, data: { overlayStatus: 'FAILED' } })
      .catch(() => undefined);
  }

  let yt: { ok: boolean; reason?: string } = { ok: false, reason: 'NOT_ATTEMPTED' };
  try {
    yt = await sendYouTube(donationId);
  } catch (e) {
    logger.error('유튜브 송출 오류 (결제는 정상 완료)', { donationId, message: (e as Error).message });
    yt = { ok: false, reason: 'DISPATCH_ERROR' };
    await prisma.donation
      .update({ where: { id: donationId }, data: { youtubeStatus: 'FAILED' } })
      .catch(() => undefined);
  }

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

/** 마스킹된 전화번호 표시명. 예: 010-****-1234 */
const MASKED_PHONE = /^\d{2,3}-\*+-\d{4}$/;

/**
 * 오버레이·TTS 에 쓸 후원자 표시명.
 *
 * 별명을 등록하지 않은 MO 후원자는 표시명이 마스킹된 전화번호로 저장된다.
 * 방송 화면과 음성에서는 끝 4자리만 부르는 편이 자연스러우므로 여기서만 줄인다.
 * (후원 원장에 저장된 displayName 은 그대로 둔다)
 */
function overlayDonorName(displayName: string): string {
  const value = (displayName || '').trim();
  if (!MASKED_PHONE.test(value) && !/^\+?\d{9,13}$/.test(value)) return value;
  return phoneTail4(value) || value;
}

/** 효과음 재생값. 설정이 없으면 기본(켜짐 / 80)으로 본다. */
function soundOf(overlay: { soundEnabled: boolean; soundVolume: number } | null) {
  return {
    soundEnabled: overlay?.soundEnabled ?? true,
    soundVolume: Math.min(100, Math.max(0, overlay?.soundVolume ?? 80)),
  };
}

/**
 * 금액 구간과 전역 설정을 합쳐 오버레이 재생값을 정한다.
 * 구간이 없으면 전역 설정만으로 기존과 동일하게 동작한다.
 */
function mergeTier(
  tier: ResolvedTier | null,
  overlay: { durationMs: number; stickerSet: string } | null,
): { effect: string; banner: boolean; durationMs: number; tierLabel: string } {
  return {
    effect: tier?.effect ?? overlay?.stickerSet ?? 'DEFAULT',
    banner: tier ? tier.banner : true,
    durationMs: tier?.durationMs ?? overlay?.durationMs ?? 7000,
    tierLabel: tier?.label ?? '',
  };
}

/**
 * TTS 재생값.
 *  - 금액 구간이 있으면 구간의 on/off · 목소리 · 속도 · 피치를 따른다.
 *  - 구간이 없으면 기존처럼 TtsSetting 의 enabled + minAmount 로 판단한다.
 *  - 문장 구성 규칙(이름/금액 읽기, 최대 글자수)은 항상 TtsSetting 을 따른다.
 */
function buildTts(
  tier: ResolvedTier | null,
  tts: {
    enabled: boolean; voice: string; speed: number; volume: number;
    readAmount: boolean; readName: boolean; minAmount: bigint; maxChars: number;
  } | null,
  input: { donorName: string; amount: bigint; message: string },
): OverlayEventPayload['tts'] {
  const enabled = tier ? tier.ttsEnabled : Boolean(tts?.enabled) && input.amount >= (tts?.minAmount ?? 0n);
  if (!enabled) return null;

  return {
    enabled: true,
    text: buildTtsText({
      donorName: input.donorName,
      amount: input.amount,
      message: input.message,
      readAmount: tts?.readAmount ?? true,
      readName: tts?.readName ?? true,
      maxChars: tts?.maxChars ?? 80,
    }),
    voice: (tier?.ttsVoice || tts?.voice) ?? '',
    speed: tier?.ttsSpeed ?? tts?.speed ?? 1,
    pitch: tier?.ttsPitch ?? 1,
    volume: tts?.volume ?? 1,
  };
}

export async function buildOverlayPayload(donationId: string, isTest = false): Promise<OverlayEventPayload | null> {
  const donation = await prisma.donation.findUnique({
    where: { id: donationId },
    include: { creator: { include: { overlaySetting: true, ttsSetting: true } } },
  });
  if (!donation) return null;

  const overlay = donation.creator.overlaySetting;
  const tts = donation.creator.ttsSetting;
  const donorName =
    overlay?.anonymize || donation.anonymous ? '익명의 후원자' : overlayDonorName(donation.displayName);
  const message = overlay?.showMessage === false ? '' : donation.message;

  const tier = await resolveOverlayTier(donation.creatorId, donation.amount);
  const merged = mergeTier(tier, overlay);

  return {
    eventId: newId(),
    creatorId: donation.creatorId,
    donationId: donation.id,
    donorName,
    amount: overlay?.showAmount === false ? '' : donation.amount.toString(),
    message,
    sticker: overlay?.stickerSet ?? 'DEFAULT',
    effect: merged.effect,
    banner: merged.banner,
    tierLabel: merged.tierLabel,
    tts: buildTts(tier, tts, { donorName, amount: donation.amount, message }),
    ttsMode: normalizeTtsProvider(tts?.provider) === 'naver' ? 'server' : 'browser',
    ...soundOf(overlay),
    durationMs: merged.durationMs,
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

  // EXPIRED 는 "이전 갱신이 한 번 실패했다"는 뜻일 뿐 영구 실패가 아니다.
  // (일시적인 네트워크 오류로 EXPIRED 가 되면 다시는 시도하지 않아 채팅 전송이 영영 멈춘다)
  // REVOKED / ERROR 는 사람이 다시 연결해야 하므로 시도하지 않는다.
  if (!conn || (conn.status !== 'CONNECTED' && conn.status !== 'EXPIRED')) return skip('NO_CONNECTION');

  const adapter = getYouTubeAdapter();

  // 액세스 토큰 만료 시 갱신. EXPIRED 상태면 만료 시각과 무관하게 한 번 더 갱신을 시도한다.
  let accessToken = decrypt(conn.accessTokenEnc);
  if (conn.status === 'EXPIRED' || conn.expiresAt.getTime() < Date.now() + 60_000) {
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

  // 조회 실패(API 오류)와 "방송 없음"은 원인이 완전히 다르다.
  //  - API_ERROR      : 우리 쪽/구글 쪽 문제. 로그와 lastError 로 추적해야 한다.
  //  - NO_ACTIVE_BROADCAST : 크리에이터가 방송 중이 아님. 정상 상황이다.
  const live = await adapter.findActiveBroadcast(accessToken);
  if (!live.ok) {
    await prisma.youTubeConnection
      .update({
        where: { id: conn.id },
        data: { lastError: live.message ?? '라이브 방송 조회 실패', lastCheckedAt: new Date() },
      })
      .catch(() => undefined);
    logger.warn('유튜브 라이브 방송 조회 실패', {
      donationId,
      code: live.code ?? null,
      message: live.message ?? null,
    });
    return skip('BROADCAST_LOOKUP_FAILED');
  }
  if (!live.data || !live.data.liveChatId) return skip('NO_ACTIVE_BROADCAST');

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

/**
 * 테스트 후원: 실제 결제/정산에 반영하지 않고 화면과 TTS 만 확인한다.
 * 금액에 해당하는 금액 구간이 그대로 적용되므로, 구간별 미리보기는
 * 해당 구간의 최소 금액으로 이 함수를 호출하면 된다.
 */
export async function sendTestOverlay(
  creatorId: string,
  input: { donorName: string; amount: bigint; message: string },
) {
  const creator = await prisma.creatorProfile.findUnique({
    where: { id: creatorId },
    include: { overlaySetting: true, ttsSetting: true },
  });
  if (!creator) throw new Error('크리에이터를 찾을 수 없습니다.');

  const tier = await resolveOverlayTier(creatorId, input.amount);
  const merged = mergeTier(tier, creator.overlaySetting);

  const payload: OverlayEventPayload = {
    eventId: newId(),
    creatorId,
    donationId: null,
    donorName: input.donorName,
    amount: input.amount.toString(),
    message: input.message,
    sticker: creator.overlaySetting?.stickerSet ?? 'DEFAULT',
    effect: merged.effect,
    banner: merged.banner,
    tierLabel: merged.tierLabel,
    tts: buildTts(tier, creator.ttsSetting, input),
    ttsMode: normalizeTtsProvider(creator.ttsSetting?.provider) === 'naver' ? 'server' : 'browser',
    ...soundOf(creator.overlaySetting),
    durationMs: merged.durationMs,
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
