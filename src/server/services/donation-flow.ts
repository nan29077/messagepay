import { prisma } from '@/server/db';
import { newId, newOrderNo, newTransactionNo } from '@/lib/id';
import { decrypt, encrypt, maskPhone, normalizePhone, phoneHash as hashPhone } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';
import type { MoInbound } from '@/server/adapters/mo';
import { getMtAdapter, decideMessageType } from '@/server/adapters/mt';
import { getPaymentAdapter, MockPaymentTimeout } from '@/server/adapters/payment';
import { filterContent, splitKeyword, type BannedWordRule } from './content-filter';
import { checkLimits, commitCounters, registerFailure, clearFailures, resolvePolicy } from './limits';
import { acquireIdempotency } from './idempotency';
import { issueSecureLink, LINK_TTL_SEC } from './secure-link';
import * as tpl from './mt-templates';
import { calculateFees, postDonationSettlement } from './settlement';
import { notifySuperAdmins } from './notifications';
import { dispatchBroadcast } from './broadcast-dispatch';
import type { DonationStatus, MoProcessResult, PaymentMode } from '@/generated/prisma/enums';
import type { TemplateOutput } from './mt-templates';

/**
 * MO 수신 → 후원 거래 → 결제 → 방송 노출로 이어지는 핵심 흐름.
 *
 * 절대 원칙
 *  1) 결제 성공 건만 방송(유튜브/오버레이/TTS)에 노출한다.
 *  2) 결제 성공과 방송 전송 성공을 같은 상태로 취급하지 않는다.
 *  3) 같은 MO 가 재전송되어도 결제가 중복 승인되지 않는다.
 */

export interface MoHandleResult {
  result: MoProcessResult;
  moMessageId?: string;
  donationId?: string;
  status?: DonationStatus;
  message: string;
}

// ---------------------------------------------------------------------------
// 보조
// ---------------------------------------------------------------------------

async function sendMt(input: {
  phone: string;
  template: TemplateOutput;
  donationId?: string | null;
  creatorId?: string | null;
}) {
  const adapter = getMtAdapter();
  const row = await prisma.mtOutboundMessage.create({
    data: {
      id: newId(),
      phoneHash: hashPhone(input.phone),
      phoneEnc: encrypt(normalizePhone(input.phone)),
      phoneMasked: maskPhone(input.phone),
      fromNumber: env.mt.fromNumber,
      messageType: decideMessageType(input.template.text),
      templateCode: input.template.code,
      bodyMasked: input.template.masked,
      donationId: input.donationId ?? null,
      creatorId: input.creatorId ?? null,
    },
  });

  try {
    const res = await adapter.send({ to: normalizePhone(input.phone), text: input.template.text, templateCode: input.template.code });
    await prisma.mtOutboundMessage.update({
      where: { id: row.id },
      data: {
        status: res.ok ? 'SENT' : 'FAILED',
        providerCode: adapter.info().provider,
        providerMessageId: res.data?.providerMessageId ?? null,
        resultCode: res.code ?? null,
        resultMessage: res.message ?? null,
        attempts: { increment: 1 },
        sentAt: res.ok ? new Date() : null,
      },
    });
    if (input.donationId) {
      await prisma.donation.update({
        where: { id: input.donationId },
        data: { mtStatus: res.ok ? 'SENT' : 'FAILED' },
      });
    }
    return res.ok;
  } catch (e) {
    await prisma.mtOutboundMessage.update({
      where: { id: row.id },
      data: { status: 'FAILED', resultMessage: (e as Error).message, attempts: { increment: 1 } },
    });
    logger.error('MT 발송 실패', { message: (e as Error).message });
    return false;
  }
}

/**
 * 결제 결과 미확인(UNKNOWN) 건을 관리자 확인 큐에 올린다.
 *
 * 출금이 실제로 일어났는지 앱이 알 수 없는 상태이므로, 사람이 결제사 원장과
 * 대사해서 승인/실패를 확정해야 한다. 같은 거래로 여러 번 올라오지 않도록
 * 미해결 건이 이미 있으면 새로 만들지 않는다.
 */
async function raiseUnknownPaymentAlert(
  donationId: string,
  transactionId: string,
  orderNo: string,
  amount: bigint,
) {
  try {
    const existing = await prisma.riskDetection.findFirst({
      where: { donationId, type: 'PAYMENT_UNKNOWN', resolved: false },
      select: { id: true },
    });
    if (existing) return;
    await prisma.riskDetection.create({
      data: {
        id: newId(),
        donationId,
        type: 'PAYMENT_UNKNOWN',
        level: 'CRITICAL',
        detail: {
          transactionId,
          orderNo,
          amount: amount.toString(),
          note: '결제 승인 결과를 확인하지 못했습니다. 결제사 원장과 대사한 뒤 승인/실패를 확정해 주세요.',
        } as object,
      },
    });

    // 화면을 열어보기 전에도 알 수 있도록 최고관리자 알림함에도 올린다.
    // 이 건은 후원자 통장에서 돈이 빠졌을 수 있어 대사가 늦을수록 손해가 커진다.
    await notifySuperAdmins({
      title: '결제 결과를 확인하지 못한 건이 있습니다',
      body: `주문번호 ${orderNo} · ${amount.toString()}원. 결제사 원장과 대사한 뒤 승인/실패를 확정해 주세요.`,
      linkUrl: '/admin/payments',
    });
  } catch (e) {
    // 알림 생성 실패가 결제 처리 흐름을 막으면 안 된다. 로그로만 남긴다.
    logger.error('결제 미확인 알림 생성 실패', { donationId, message: (e as Error).message });
  }
}

async function setStatus(donationId: string, to: DonationStatus, reason?: string, actor = 'system') {
  const cur = await prisma.donation.findUnique({ where: { id: donationId }, select: { status: true } });
  await prisma.$transaction([
    prisma.donation.update({ where: { id: donationId }, data: { status: to, statusReason: reason ?? null } }),
    prisma.donationStatusLog.create({
      data: { id: newId(), donationId, fromStatus: cur?.status ?? null, toStatus: to, reason: reason ?? null, actor },
    }),
  ]);
}

export async function loadBannedWords(creatorId: string): Promise<BannedWordRule[]> {
  const rows = await prisma.bannedWord.findMany({
    where: { active: true, OR: [{ scope: 'GLOBAL' }, { creatorId }] },
    select: { word: true, action: true },
  });
  return rows.map((r) => ({ word: r.word, action: r.action }));
}

/** 수신번호(+키워드)로 크리에이터를 찾는다. */

/**
 * 문자 본문 맨 앞의 "N원" 표기를 금액 지정으로 해석한다.
 * 예) "5000원 오늘도 화이팅" → amount 5000, rest "오늘도 화이팅"
 *     "1,000원" → amount 1000, rest ""
 * 표기가 없으면 크리에이터 기본 후원금을 사용한다.
 * 파싱된 금액이 정책 범위를 벗어나면 이후 checkLimits 에서 AMOUNT_RANGE 로 차단되고 안내 문자가 발송된다.
 */
export function parseExplicitAmount(body: string): { amount: bigint | null; rest: string } {
  const m = body.match(/^\s*(\d{1,3}(?:,\d{3})+|\d{3,7})원(?=\s|$)/u);
  if (!m) return { amount: null, rest: body };
  const digits = m[1].replace(/,/g, '');
  try {
    return { amount: BigInt(digits), rest: body.slice(m[0].length).trim() };
  } catch {
    return { amount: null, rest: body };
  }
}

export async function routeCreator(receivedNumber: string, content: string) {
  const number = normalizePhone(receivedNumber) || receivedNumber;

  // 같은 번호에 걸린 배정 행을 한 번에 읽는다.
  // 전용(DEDICATED)과 대표번호공유(SHARED_PREFIX)가 같은 번호에 공존하면
  // 전용이 먼저 매칭돼 대표번호를 쓰던 모든 크리에이터의 후원이 전용 크리에이터
  // 1명에게 흘러들어간다. 후원자도 크리에이터도 알아챌 수 없는 사고이므로
  // 라우팅을 진행하지 않고 차단한 뒤 관리자에게 알린다.
  const rows = await prisma.creatorMoNumber.findMany({
    where: { phoneNumber: number, status: 'ASSIGNED', creatorId: { not: null } },
    include: { creator: true },
    orderBy: { assignedAt: 'desc' },
  });

  const dedicatedRows = rows.filter((r) => r.mode === 'DEDICATED');
  const sharedRows = rows.filter((r) => r.mode === 'SHARED_PREFIX');

  if (dedicatedRows.length > 1 || (dedicatedRows.length > 0 && sharedRows.length > 0)) {
    logger.error('MO 번호 라우팅 충돌 — 배정 설정을 정리해야 합니다', {
      phoneNumber: number,
      dedicated: dedicatedRows.length,
      shared: sharedRows.length,
      creators: rows.map((r) => r.creator?.code).filter(Boolean),
    });
    return null;
  }

  // 1) 전용번호 우선
  const dedicated = dedicatedRows[0];
  if (dedicated?.creator) {
    return { route: dedicated, creator: dedicated.creator, keyword: null as string | null, body: content };
  }

  // 2) 대표번호 + 키워드
  const { keyword, rest } = splitKeyword(content);
  if (keyword) {
    const shared = sharedRows.find((r) => r.keyword === keyword);
    if (shared?.creator) {
      return { route: shared, creator: shared.creator, keyword, body: rest };
    }
  }

  return null;
}

async function getOrCreateDonor(phone: string) {
  const ph = hashPhone(phone);
  return prisma.donorProfile.upsert({
    where: { phoneHash: ph },
    update: {},
    create: {
      id: newId(),
      phoneHash: ph,
      phoneEnc: encrypt(normalizePhone(phone)),
      phoneMasked: maskPhone(phone),
    },
  });
}

/** 같은 전화번호의 동시 MO 중 한 요청만 최초 가입 안내 발송권을 얻는다. */
async function claimRegistrationGuide(donorId: string) {
  const claimedAt = new Date();
  const claimed = await prisma.donorProfile.updateMany({
    where: { id: donorId, onboardingStatus: 'UNREGISTERED' },
    data: { onboardingStatus: 'LINK_SENT', registrationLinkSentAt: claimedAt },
  });
  return { claimed: claimed.count === 1, claimedAt };
}

async function releaseRegistrationGuideClaim(donorId: string, claimedAt: Date) {
  await prisma.donorProfile.updateMany({
    where: { id: donorId, onboardingStatus: 'LINK_SENT', registrationLinkSentAt: claimedAt },
    data: { onboardingStatus: 'UNREGISTERED', registrationLinkSentAt: null },
  });
}

export function resolvePaymentMode(
  creatorMode: PaymentMode | null,
  allowDirectTrigger: boolean = env.safety.allowDirectTrigger,
): PaymentMode {
  const desired = creatorMode ?? 'CONFIRM_LINK';
  if (desired === 'DIRECT_TRIGGER' && !allowDirectTrigger) {
    // 금융사 서면승인 등록 전에는 DIRECT_TRIGGER 를 사용할 수 없다.
    return 'CONFIRM_LINK';
  }
  return desired;
}

// ---------------------------------------------------------------------------
// MO 수신 처리
// ---------------------------------------------------------------------------

export async function handleMoInbound(inbound: MoInbound): Promise<MoHandleResult> {
  const ph = hashPhone(inbound.fromNumber);

  // (1) 사업자 메시지 ID 기준 중복 차단
  const dup = await prisma.moInboundMessage.findUnique({
    where: { providerMessageId: inbound.providerMessageId },
    select: { id: true, result: true, donation: { select: { id: true, status: true } } },
  });
  // 이전 수신이 후원 생성 전에 예외로 끝난 건(result=ERROR, 후원 없음)은 사업자 재전송 시 다시 처리한다.
  // 그 외에는 모두 중복으로 막는다.
  const retryable = Boolean(dup && dup.result === 'ERROR' && !dup.donation);
  if (dup && !retryable) {
    return {
      result: 'DUPLICATE',
      moMessageId: dup.id,
      donationId: dup.donation?.id,
      status: dup.donation?.status,
      message: '이미 처리된 문자입니다. 중복 결제는 발생하지 않습니다.',
    };
  }

  const routed = await routeCreator(inbound.receivedNumber, inbound.content);

  let moRow;
  try {
    moRow = await createOrReuseMoRow(inbound, routed, ph, dup?.id ?? null);
  } catch {
    // 동시 재전송 경합
    const again = await prisma.moInboundMessage.findUnique({
      where: { providerMessageId: inbound.providerMessageId },
      select: { id: true },
    });
    return { result: 'DUPLICATE', moMessageId: again?.id, message: '중복 수신(경합)으로 무시되었습니다.' };
  }

  try {
    return await processMoRow(inbound, routed, ph, moRow);
  } catch (error) {
    // 예외로 끝난 행을 PENDING 으로 남기면 재전송이 영원히 DUPLICATE 로 막힌다.
    // 후원이 만들어지기 전에 실패한 행만 ERROR 로 표시해 관리자 화면에 드러내고 재전송을 허용한다.
    // (후원이 이미 생긴 뒤의 예외는 후원 상태·결제 기록이 진실이므로 수신 결과를 덮어쓰지 않는다)
    await prisma.moInboundMessage
      .updateMany({
        where: { id: moRow.id, donation: null },
        data: {
          result: 'ERROR',
          resultDetail: `처리 오류: ${(error as Error).message}`.slice(0, 500),
          processedAt: new Date(),
        },
      })
      .catch(() => undefined);
    throw error;
  }
}

type RoutedCreator = Awaited<ReturnType<typeof routeCreator>>;

async function createOrReuseMoRow(inbound: MoInbound, routed: RoutedCreator, ph: string, reuseId: string | null) {
  if (reuseId) {
    return prisma.moInboundMessage.update({
      where: { id: reuseId },
      data: {
        result: 'PENDING',
        resultDetail: null,
        processedAt: null,
        creatorId: routed?.creator.id ?? null,
        matchedKeyword: routed?.keyword ?? null,
      },
    });
  }
  return prisma.moInboundMessage.create({
      data: {
        id: newId(),
        providerMessageId: inbound.providerMessageId,
        providerCode: inbound.providerCode,
        receivedNumber: inbound.receivedNumber,
        phoneHash: ph,
        phoneEnc: encrypt(normalizePhone(inbound.fromNumber)),
        phoneMasked: maskPhone(inbound.fromNumber),
        messageType: inbound.messageType,
        contentEnc: encrypt(inbound.content),
        attachmentInfo: (inbound.attachments ?? []) as object,
        creatorId: routed?.creator.id ?? null,
        matchedKeyword: routed?.keyword ?? null,
        receivedAt: inbound.receivedAt,
      },
    });
}

async function processMoRow(
  inbound: MoInbound,
  routed: RoutedCreator,
  ph: string,
  moRow: { id: string },
): Promise<MoHandleResult> {
  // (2) 라우팅 실패
  if (!routed) {
    await prisma.moInboundMessage.update({
      where: { id: moRow.id },
      data: { result: 'UNKNOWN_ROUTE', resultDetail: '배정된 크리에이터 없음', processedAt: new Date() },
    });
    await sendMt({ phone: inbound.fromNumber, template: tpl.tplUnknownRoute() });
    return { result: 'UNKNOWN_ROUTE', moMessageId: moRow.id, message: '크리에이터를 찾을 수 없습니다.' };
  }

  const creator = routed.creator;
  if (creator.status !== 'APPROVED') {
    await prisma.moInboundMessage.update({
      where: { id: moRow.id },
      data: { result: 'BLOCKED', resultDetail: `크리에이터 상태: ${creator.status}`, processedAt: new Date() },
    });
    await sendMt({ phone: inbound.fromNumber, template: tpl.tplUnknownRoute() });
    return { result: 'BLOCKED', moMessageId: moRow.id, message: '이용할 수 없는 크리에이터입니다.' };
  }

  const donor = await getOrCreateDonor(inbound.fromNumber);

  // (3) 실제 활성 빌키가 있을 때만 후원 결제로 진행한다.
  const token = await prisma.paymentMethodToken.findFirst({
    where: { donorId: donor.id, status: 'ACTIVE' },
    orderBy: { registeredAt: 'desc' },
  });

  if (!token) {
    const current = await prisma.donorProfile.findUniqueOrThrow({ where: { id: donor.id } });
    await prisma.moInboundMessage.update({
      where: { id: moRow.id },
      data: {
        result: 'UNREGISTERED_DONOR',
        resultDetail:
          current.onboardingStatus === 'LINK_SENT' ? '가입 안내 발송 완료·가입 대기' : `가입 상태: ${current.onboardingStatus}`,
        processedAt: new Date(),
      },
    });

    // 이전 안내 링크(30분)가 만료됐는데도 LINK_SENT 에 머물면 이후 모든 문자가 영원히 안내 없이 끝난다.
    // 만료 뒤 첫 문자에서 UNREGISTERED 로 되돌려 새 링크를 한 번 더 보낸다.
    if (current.onboardingStatus === 'LINK_SENT' && current.registrationLinkSentAt) {
      const expiredAt = current.registrationLinkSentAt.getTime() + LINK_TTL_SEC.REGISTER_ACCOUNT * 1000;
      if (expiredAt < Date.now()) {
        await prisma.donorProfile.updateMany({
          where: { id: donor.id, onboardingStatus: 'LINK_SENT', registrationLinkSentAt: current.registrationLinkSentAt },
          data: { onboardingStatus: 'UNREGISTERED', registrationLinkSentAt: null },
        });
      }
    }

    const claim = await claimRegistrationGuide(donor.id);
    if (claim.claimed) {
      try {
        const link = await issueSecureLink({
          purpose: 'REGISTER_ACCOUNT',
          phoneHash: ph,
          creatorId: creator.id,
          payload: { moMessageId: moRow.id },
        });
        const sent = await sendMt({
          phone: inbound.fromNumber,
          template: tpl.tplRegisterGuide(creator.displayName, link.url),
          creatorId: creator.id,
        });
        if (!sent) await releaseRegistrationGuideClaim(donor.id, claim.claimedAt);
      } catch (error) {
        await releaseRegistrationGuideClaim(donor.id, claim.claimedAt);
        throw error;
      }
      return {
        result: 'UNREGISTERED_DONOR',
        moMessageId: moRow.id,
        message: '미등록 이용자입니다. 최초 가입 안내를 발송했습니다. 이 문자는 후원 처리되지 않습니다.',
      };
    }

    if (
      current.onboardingStatus === 'REGISTERED' ||
      current.onboardingStatus === 'SUSPENDED' ||
      current.onboardingStatus === 'WITHDRAWN'
    ) {
      if (current.onboardingStatus === 'REGISTERED') {
        await prisma.donorProfile.update({
          where: { id: donor.id },
          data: { onboardingStatus: 'SUSPENDED' },
        });
      }
      await sendMt({
        phone: inbound.fromNumber,
        template: tpl.tplAccountInactive(creator.displayName),
        creatorId: creator.id,
      });
      return {
        result: 'UNREGISTERED_DONOR',
        moMessageId: moRow.id,
        message: '내통장결제 이용이 중지된 번호입니다. 결제는 진행되지 않았습니다.',
      };
    }

    return {
      result: 'UNREGISTERED_DONOR',
      moMessageId: moRow.id,
      message: '가입 안내가 이미 발송된 번호입니다. 가입 완료 전 문자는 후원 처리되지 않으며 링크를 다시 보내지 않습니다.',
    };
  }

  // 기존 데이터 이관·복구 상황에서도 활성 빌키가 실제 결제 가능 상태의 기준이다.
  if (donor.onboardingStatus !== 'REGISTERED') {
    await prisma.donorProfile.update({
      where: { id: donor.id },
      data: { onboardingStatus: 'REGISTERED', registeredAt: donor.registeredAt ?? token.registeredAt },
    });
  }

  // (4) 금액 지정 파싱 + 콘텐츠 필터
  // 후원 페이지에서 금액을 선택해 보내면 본문 맨 앞에 "5000원" 형태의 표기가 붙는다.
  const amountSpec = parseExplicitAmount(routed.body);
  const bannedWords = await loadBannedWords(creator.id);
  const overlay = await prisma.overlaySetting.findUnique({ where: { creatorId: creator.id } });
  const filtered = filterContent(amountSpec.rest, {
    bannedWords,
    maxLength: overlay?.maxMessageLen ?? 80,
  });

  const amount = amountSpec.amount ?? creator.donationAmount;
  const displayName = donor.displayName || maskPhone(inbound.fromNumber);

  // (5) 후원 거래 생성 (멱등)
  const idem = await acquireIdempotency('donation', `${creator.id}:${inbound.providerMessageId}`);
  if (idem.status === 'DUPLICATE') {
    return {
      result: 'DUPLICATE',
      moMessageId: moRow.id,
      donationId: idem.resourceId ?? undefined,
      message: '이미 생성된 후원 거래입니다.',
    };
  }

  const donation = await prisma.donation.create({
    data: {
      id: newId(),
      transactionNo: newTransactionNo(),
      creatorId: creator.id,
      donorId: donor.id,
      moMessageId: moRow.id,
      amount,
      displayName,
      message: filtered.clean,
      messageRawEnc: encrypt(routed.body),
      status: 'RECEIVED',
      paymentMode: resolvePaymentMode(creator.paymentMode),
    },
  });
  await idem.release(donation.id);

  await prisma.moInboundMessage.update({
    where: { id: moRow.id },
    data: { result: 'ROUTED', contentFiltered: filtered.clean, processedAt: new Date() },
  });

  // (6) 콘텐츠 차단
  if (filtered.action === 'BLOCK') {
    await setStatus(donation.id, 'CONTENT_BLOCKED', filtered.reasons.join(', '));
    await sendMt({
      phone: inbound.fromNumber,
      template: tpl.tplContentBlocked(creator.displayName),
      donationId: donation.id,
      creatorId: creator.id,
    });
    return { result: 'BLOCKED', moMessageId: moRow.id, donationId: donation.id, status: 'CONTENT_BLOCKED', message: '금칙어로 차단되었습니다.' };
  }

  // (7) 한도 확인
  const blocked = await prisma.blockedDonor.findUnique({
    where: { creatorId_donorId: { creatorId: creator.id, donorId: donor.id } },
  });
  const limit = await checkLimits({
    donor,
    creatorId: creator.id,
    amount,
    blockedByCreator: Boolean(blocked),
  });

  if (!limit.ok) {
    await setStatus(donation.id, 'LIMIT_BLOCKED', `${limit.code}: ${limit.message}`);
    await prisma.riskDetection.create({
      data: {
        id: newId(),
        donorId: donor.id,
        creatorId: creator.id,
        donationId: donation.id,
        type: limit.code === 'VELOCITY' || limit.code === 'COOLDOWN' ? 'VELOCITY' : 'DAILY_LIMIT',
        level: 'MEDIUM',
        detail: { code: limit.code, message: limit.message } as object,
      },
    });
    await sendMt({
      phone: inbound.fromNumber,
      template: tpl.tplLimitBlocked(creator.displayName, limit.message ?? '이용 한도'),
      donationId: donation.id,
      creatorId: creator.id,
    });
    return { result: 'BLOCKED', moMessageId: moRow.id, donationId: donation.id, status: 'LIMIT_BLOCKED', message: limit.message ?? '한도 초과' };
  }

  // (8) 결제 모드에 따른 분기
  if (donation.paymentMode === 'CONFIRM_LINK') {
    await setStatus(donation.id, 'PENDING_CONFIRM', '후원자 확인 대기');
    const link = await issueSecureLink({
      purpose: 'CONFIRM_PAYMENT',
      phoneHash: ph,
      creatorId: creator.id,
      donationId: donation.id,
    });
    await sendMt({
      phone: inbound.fromNumber,
      template: tpl.tplConfirmPayment(
        creator.displayName,
        amount,
        link.url,
        Math.floor(env.payment.confirmTtlSec / 60),
      ),
      donationId: donation.id,
      creatorId: creator.id,
    });
    return {
      result: 'ROUTED',
      moMessageId: moRow.id,
      donationId: donation.id,
      status: 'PENDING_CONFIRM',
      message: '결제 확인 링크를 발송했습니다.',
    };
  }

  // DIRECT_TRIGGER
  const paid = await executePayment(donation.id);
  return {
    result: 'ROUTED',
    moMessageId: moRow.id,
    donationId: donation.id,
    status: paid.status,
    message: paid.message,
  };
}

// ---------------------------------------------------------------------------
// 결제 실행
// ---------------------------------------------------------------------------

export interface PaymentOutcome {
  ok: boolean;
  status: DonationStatus;
  message: string;
}

export async function executePayment(donationId: string): Promise<PaymentOutcome> {
  const donation = await prisma.donation.findUnique({
    where: { id: donationId },
    include: { creator: true, donor: true },
  });
  if (!donation) return { ok: false, status: 'PAYMENT_FAILED', message: '후원 거래를 찾을 수 없습니다.' };
  if (!donation.donor) return { ok: false, status: 'UNREGISTERED', message: '후원자 정보가 없습니다.' };

  if (['PAYMENT_SUCCESS', 'BROADCAST_PENDING', 'BROADCASTED', 'PARTIAL_DELIVERY_FAILED', 'SETTLEMENT_PENDING', 'SETTLED'].includes(donation.status)) {
    return { ok: true, status: donation.status, message: '이미 결제가 완료된 거래입니다.' };
  }

  const token = await prisma.paymentMethodToken.findFirst({
    where: { donorId: donation.donorId!, status: 'ACTIVE' },
    orderBy: { registeredAt: 'desc' },
  });
  if (!token) {
    await setStatus(donationId, 'UNREGISTERED', '활성 결제수단 없음');
    return { ok: false, status: 'UNREGISTERED', message: '등록된 결제수단이 없습니다.' };
  }

  // 결제 직전 한도 재검사.
  // 카운터는 결제 성공 시에만 증가하므로, 확인 링크를 여러 장 받아 두었다가 한꺼번에 누르면
  // 접수 시점 검사만으로는 일/월 한도를 얼마든지 넘길 수 있다. 실제 출금 직전에 다시 확인한다.
  const blockedNow = await prisma.blockedDonor.findUnique({
    where: { creatorId_donorId: { creatorId: donation.creatorId, donorId: donation.donorId! } },
  });
  const limitNow = await checkLimits({
    donor: donation.donor,
    creatorId: donation.creatorId,
    amount: donation.amount,
    blockedByCreator: Boolean(blockedNow),
    // 접수 시점에 이미 속도 제한 카운터를 소진했다. 여기서 또 올리면 1건이 2건으로 세어진다.
    consumeVelocity: false,
  });
  if (!limitNow.ok) {
    await setStatus(donationId, 'LIMIT_BLOCKED', `${limitNow.code}: ${limitNow.message}`);
    await prisma.riskDetection.create({
      data: {
        id: newId(),
        donorId: donation.donorId!,
        creatorId: donation.creatorId,
        donationId: donation.id,
        type: limitNow.code === 'VELOCITY' || limitNow.code === 'COOLDOWN' ? 'VELOCITY' : 'DAILY_LIMIT',
        level: 'MEDIUM',
        detail: { code: limitNow.code, message: limitNow.message, stage: 'PRE_PAYMENT' } as object,
      },
    });
    await sendMtForDonor(
      donation.donorId!,
      tpl.tplLimitBlocked(donation.creator.displayName, limitNow.message ?? '이용 한도'),
      donationId,
      donation.creatorId,
    );
    return { ok: false, status: 'LIMIT_BLOCKED', message: limitNow.message ?? '이용 한도를 초과했습니다.' };
  }

  // 결제 트랜잭션은 거래당 1건만 생성한다(주문번호를 멱등키로 재사용).
  let txn = await prisma.paymentTransaction.findFirst({ where: { donationId }, orderBy: { requestedAt: 'desc' } });
  if (!txn) {
    txn = await prisma.paymentTransaction.create({
      data: {
        id: newId(),
        donationId,
        orderNo: newOrderNo(),
        provider: env.payment.provider,
        amount: donation.amount,
      },
    });
  } else if (txn.status === 'APPROVED') {
    return { ok: true, status: 'PAYMENT_SUCCESS', message: '이미 승인된 결제입니다.' };
  }

  await setStatus(donationId, 'PENDING_PAYMENT', '결제 승인 요청');

  const adapter = getPaymentAdapter();
  const started = Date.now();
  let attemptNo = (await prisma.paymentAttempt.count({ where: { transactionId: txn.id } })) + 1;

  let approved: { providerTid: string; approvedAt: Date } | null = null;
  let failure: { code?: string; message?: string } | null = null;

  try {
    const res = await adapter.approve({
      orderNo: txn.orderNo,
      amount: donation.amount,
      billKey: decryptBillKey(token.billKeyEnc),
      productName: `${donation.creator.displayName} 문자후원`,
      buyerName: donation.displayName,
    });
    await prisma.paymentAttempt.create({
      data: {
        id: newId(), transactionId: txn.id, attemptNo, operation: 'APPROVE',
        responseMasked: { ok: res.ok, code: res.code ?? null, message: res.message ?? null } as object,
        latencyMs: Date.now() - started,
        errorCode: res.ok ? null : res.code ?? null,
        errorMessage: res.ok ? null : res.message ?? null,
      },
    });
    if (res.ok && res.data) approved = { providerTid: res.data.providerTid, approvedAt: res.data.approvedAt };
    else failure = { code: res.code, message: res.message };
  } catch (e) {
    // 타임아웃/네트워크 오류: 반드시 거래결과조회로 최종 상태를 확정한다.
    const isTimeout = e instanceof MockPaymentTimeout || /timeout|ETIMEDOUT|ECONNRESET/i.test((e as Error).message);
    await prisma.paymentAttempt.create({
      data: {
        id: newId(), transactionId: txn.id, attemptNo, operation: 'APPROVE',
        latencyMs: Date.now() - started, errorCode: isTimeout ? 'TIMEOUT' : 'ERROR',
        errorMessage: (e as Error).message,
      },
    });
    attemptNo += 1;
    await prisma.paymentTransaction.update({ where: { id: txn.id }, data: { status: 'TIMEOUT' } });

    // 거래결과조회 자체가 실패해도 예외를 밖으로 내보내지 않는다.
    // 여기서 throw 하면 후원이 PENDING_PAYMENT 로 영구히 멈춰 아무도 복구할 수 없다.
    // 조회 불가 = "결과 미확인(UNKNOWN)" 으로 확정하고 관리자 확인 큐로 보낸다.
    let inq: Awaited<ReturnType<typeof adapter.inquire>> | null = null;
    try {
      inq = await adapter.inquire(txn.orderNo);
    } catch (inqErr) {
      logger.error('거래결과조회 실패', { donationId, orderNo: txn.orderNo, message: (inqErr as Error).message });
    }
    await prisma.paymentAttempt.create({
      data: {
        id: newId(), transactionId: txn.id, attemptNo, operation: 'INQUIRE',
        responseMasked: { status: inq?.data?.status ?? 'UNKNOWN' } as object,
        errorCode: inq ? null : 'INQUIRE_ERROR',
      },
    });
    if (inq?.ok && inq.data?.status === 'APPROVED') {
      approved = { providerTid: inq.data.providerTid ?? txn.orderNo, approvedAt: new Date() };
    } else if (inq?.ok && inq.data?.status === 'FAILED') {
      failure = { code: 'TIMEOUT_FAILED', message: '결제가 완료되지 않았습니다.' };
    } else {
      failure = { code: 'UNKNOWN', message: '결제 결과를 확인할 수 없습니다. 관리자 확인이 필요합니다.' };
    }
  }

  const phone = donation.donor.phoneMasked;

  if (!approved) {
    // ── 결과 미확인(UNKNOWN) ────────────────────────────────────────────
    // 출금이 실제로 일어났을 수 있으므로 "실패"로 확정하면 안 된다.
    // FAILED 로 덮으면 (1) 원장 분개가 없어 크리에이터에게 정산되지 않고
    // (2) 후원자에게 실패 문자가 나가며 (3) 실패 카운터로 정상 후원자가 잠기고
    // (4) 관리자 '확인 필요' 큐(status IN UNKNOWN,TIMEOUT)가 영구히 비어 대사 자체가 불가능해진다.
    // 따라서 UNKNOWN 은 UNKNOWN 그대로 남기고 사람이 판단하도록 넘긴다.
    if (failure?.code === 'UNKNOWN') {
      await prisma.paymentTransaction.update({
        where: { id: txn.id },
        data: { status: 'UNKNOWN', resultCode: 'UNKNOWN', resultMessage: failure.message ?? null },
      });
      // 후원 상태는 PENDING_PAYMENT 로 유지한다(실패 아님). 사유만 남긴다.
      await prisma.donation.update({
        where: { id: donationId },
        data: { statusReason: '결제 결과 미확인 — 관리자 확인 대기' },
      });
      await raiseUnknownPaymentAlert(donationId, txn.id, txn.orderNo, donation.amount);
      // 실패 카운터를 올리지 않는다. 실패 문자도 보내지 않는다(이중청구 오해 방지).
      logger.error('결제 결과 미확인 — 수동 대사 필요', {
        donationId, transactionId: txn.id, orderNo: txn.orderNo, phone,
      });
      return {
        ok: false,
        status: 'PENDING_PAYMENT',
        message: '결제 결과를 확인하는 중입니다. 확인되는 대로 문자로 안내드립니다.',
      };
    }

    await prisma.paymentTransaction.update({
      where: { id: txn.id },
      data: { status: 'FAILED', resultCode: failure?.code ?? null, resultMessage: failure?.message ?? null },
    });
    await setStatus(donationId, 'PAYMENT_FAILED', failure?.message ?? '결제 실패');
    const policy = await resolvePolicy(donation.creatorId, donation.donorId);
    const locked = await registerFailure(donation.donorId!, policy.failureLockThreshold);
    await sendMtForDonor(donation.donorId!, tpl.tplDonationFailed(donation.creator.displayName, failure?.message), donationId, donation.creatorId);
    logger.warn('결제 실패', { donationId, phone, locked, code: failure?.code });
    return { ok: false, status: 'PAYMENT_FAILED', message: failure?.message ?? '결제에 실패했습니다.' };
  }

  // ── 승인 성공 ──────────────────────────────────────────────────────
  // 승인 기록과 정산 원장 분개는 반드시 같은 트랜잭션이어야 한다.
  // 둘이 갈라져 있으면 그 사이에 프로세스가 죽었을 때
  // "후원은 성공인데 원장에는 없는" 상태가 되고, 앞쪽 조기 return 가드가
  // 재시도를 '이미 완료'로 되돌려 보내 크리에이터가 그 금액을 영영 못 받는다.
  const fees = await calculateFees(donation.creatorId, donation.amount);
  await prisma.$transaction(async (tx) => {
    await tx.paymentTransaction.update({
      where: { id: txn.id },
      data: { status: 'APPROVED', providerTid: approved!.providerTid, approvedAt: approved!.approvedAt },
    });
    await tx.donation.update({
      where: { id: donationId },
      data: {
        status: 'SETTLEMENT_PENDING',
        statusReason: '정산 대기',
        paidAt: approved!.approvedAt,
        pgFee: fees.pgFee,
        platformFee: fees.platformFee,
        netAmount: fees.net,
      },
    });
    await tx.donationStatusLog.createMany({
      data: [
        { id: newId(), donationId, fromStatus: 'PENDING_PAYMENT', toStatus: 'PAYMENT_SUCCESS', actor: 'system' },
        { id: newId(), donationId, fromStatus: 'PAYMENT_SUCCESS', toStatus: 'SETTLEMENT_PENDING', reason: '정산 대기', actor: 'system' },
      ],
    });
    await tx.donorCreatorLink.upsert({
      where: { donorId_creatorId: { donorId: donation.donorId!, creatorId: donation.creatorId } },
      create: {
        id: newId(), donorId: donation.donorId!, creatorId: donation.creatorId,
        consentedAt: new Date(), totalAmount: donation.amount, totalCount: 1, lastDonatedAt: approved!.approvedAt,
      },
      update: {
        totalAmount: { increment: donation.amount },
        totalCount: { increment: 1 },
        lastDonatedAt: approved!.approvedAt,
      },
    });
    await postDonationSettlement(
      {
        creatorId: donation.creatorId,
        donationId,
        amount: donation.amount,
        fees,
        occurredAt: approved!.approvedAt,
      },
      tx,
    );
  });

  await commitCounters(donation.donorId!, donation.creatorId, donation.amount, approved.approvedAt);
  await clearFailures(donation.donorId!);

  // 누적 후원금 안내
  const link = await prisma.donorCreatorLink.findUnique({
    where: { donorId_creatorId: { donorId: donation.donorId!, creatorId: donation.creatorId } },
    select: { totalAmount: true },
  });
  await sendMtForDonor(
    donation.donorId!,
    tpl.tplDonationSuccess({
      donorName: donation.displayName,
      creatorName: donation.creator.displayName,
      amount: donation.amount,
      message: donation.message,
      cumulative: link?.totalAmount ?? donation.amount,
    }),
    donationId,
    donation.creatorId,
  );

  // 결제 성공 이후에만 방송 전송을 시도한다.
  // 송출(유튜브 댓글·오버레이·TTS) 실패가 결제 결과를 뒤집으면 안 된다.
  // 여기서 예외가 새면 결제는 승인·정산까지 끝났는데 후원자 화면에는 오류가 뜬다.
  try {
    await dispatchBroadcast(donationId);
  } catch (e) {
    logger.error('방송 송출 실패 (결제는 정상 완료)', { donationId, message: (e as Error).message });
  }

  return { ok: true, status: 'PAYMENT_SUCCESS', message: '후원이 완료되었습니다.' };
}

// ---------------------------------------------------------------------------

/** 빌키 복호화는 결제 실행 지점에서만 수행한다. 반환값은 로그에 남기지 않는다. */
function decryptBillKey(enc: string): string {
  return decrypt(enc);
}

async function sendMtForDonor(donorId: string, template: TemplateOutput, donationId?: string, creatorId?: string) {
  const donor = await prisma.donorProfile.findUnique({ where: { id: donorId } });
  if (!donor) return false;
  const phone = decrypt(donor.phoneEnc);
  return sendMt({ phone, template, donationId, creatorId });
}

export { sendMt, sendMtForDonor, setStatus };
