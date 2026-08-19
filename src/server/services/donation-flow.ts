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
import { issueSecureLink } from './secure-link';
import * as tpl from './mt-templates';
import { calculateFees, postDonationSettlement } from './settlement';
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

async function setStatus(donationId: string, to: DonationStatus, reason?: string, actor = 'system') {
  const cur = await prisma.donation.findUnique({ where: { id: donationId }, select: { status: true } });
  await prisma.$transaction([
    prisma.donation.update({ where: { id: donationId }, data: { status: to, statusReason: reason ?? null } }),
    prisma.donationStatusLog.create({
      data: { id: newId(), donationId, fromStatus: cur?.status ?? null, toStatus: to, reason: reason ?? null, actor },
    }),
  ]);
}

async function loadBannedWords(creatorId: string): Promise<BannedWordRule[]> {
  const rows = await prisma.bannedWord.findMany({
    where: { active: true, OR: [{ scope: 'GLOBAL' }, { creatorId }] },
    select: { word: true, action: true },
  });
  return rows.map((r) => ({ word: r.word, action: r.action }));
}

/** 수신번호(+키워드)로 크리에이터를 찾는다. */
export async function routeCreator(receivedNumber: string, content: string) {
  const number = normalizePhone(receivedNumber) || receivedNumber;

  // 1) 전용번호 우선
  const dedicated = await prisma.creatorMoNumber.findFirst({
    where: { phoneNumber: number, mode: 'DEDICATED', status: 'ASSIGNED', creatorId: { not: null } },
    include: { creator: true },
  });
  if (dedicated?.creator) {
    return { route: dedicated, creator: dedicated.creator, keyword: null as string | null, body: content };
  }

  // 2) 대표번호 + 키워드
  const { keyword, rest } = splitKeyword(content);
  if (keyword) {
    const shared = await prisma.creatorMoNumber.findFirst({
      where: { phoneNumber: number, mode: 'SHARED_PREFIX', keyword, status: 'ASSIGNED', creatorId: { not: null } },
      include: { creator: true },
    });
    if (shared?.creator) {
      return { route: shared, creator: shared.creator, keyword, body: rest };
    }
  }

  return null;
}

async function getOrCreateDonor(phone: string) {
  const ph = hashPhone(phone);
  const existing = await prisma.donorProfile.findUnique({ where: { phoneHash: ph } });
  if (existing) return existing;
  return prisma.donorProfile.create({
    data: {
      id: newId(),
      phoneHash: ph,
      phoneEnc: encrypt(normalizePhone(phone)),
      phoneMasked: maskPhone(phone),
    },
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
    select: { id: true, donation: { select: { id: true, status: true } } },
  });
  if (dup) {
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
    moRow = await prisma.moInboundMessage.create({
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
  } catch {
    // 동시 재전송 경합
    const again = await prisma.moInboundMessage.findUnique({
      where: { providerMessageId: inbound.providerMessageId },
      select: { id: true },
    });
    return { result: 'DUPLICATE', moMessageId: again?.id, message: '중복 수신(경합)으로 무시되었습니다.' };
  }

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

  // (3) 등록 여부 확인. 미등록이면 결제하지 않고 등록 링크만 보낸다.
  const token = await prisma.paymentMethodToken.findFirst({
    where: { donorId: donor.id, status: 'ACTIVE' },
    orderBy: { registeredAt: 'desc' },
  });

  if (!token) {
    await prisma.moInboundMessage.update({
      where: { id: moRow.id },
      data: { result: 'UNREGISTERED_DONOR', resultDetail: '계좌 미등록', processedAt: new Date() },
    });
    const link = await issueSecureLink({
      purpose: 'REGISTER_ACCOUNT',
      phoneHash: ph,
      creatorId: creator.id,
      payload: { moMessageId: moRow.id },
    });
    await sendMt({
      phone: inbound.fromNumber,
      template: tpl.tplRegisterGuide(creator.displayName, link.url),
      creatorId: creator.id,
    });
    return {
      result: 'UNREGISTERED_DONOR',
      moMessageId: moRow.id,
      message: '미등록 이용자입니다. 계좌 등록 안내를 발송했습니다. 최초 문자는 후원 처리되지 않습니다.',
    };
  }

  // (4) 콘텐츠 필터
  const bannedWords = await loadBannedWords(creator.id);
  const overlay = await prisma.overlaySetting.findUnique({ where: { creatorId: creator.id } });
  const filtered = filterContent(routed.body, {
    bannedWords,
    maxLength: overlay?.maxMessageLen ?? 80,
  });

  const amount = creator.donationAmount;
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

    const inq = await adapter.inquire(txn.orderNo);
    await prisma.paymentAttempt.create({
      data: {
        id: newId(), transactionId: txn.id, attemptNo, operation: 'INQUIRE',
        responseMasked: { status: inq.data?.status ?? 'UNKNOWN' } as object,
      },
    });
    if (inq.ok && inq.data?.status === 'APPROVED') {
      approved = { providerTid: inq.data.providerTid ?? txn.orderNo, approvedAt: new Date() };
    } else if (inq.ok && inq.data?.status === 'FAILED') {
      failure = { code: 'TIMEOUT_FAILED', message: '결제가 완료되지 않았습니다.' };
    } else {
      failure = { code: 'UNKNOWN', message: '결제 결과를 확인할 수 없습니다. 관리자 확인이 필요합니다.' };
      await prisma.paymentTransaction.update({ where: { id: txn.id }, data: { status: 'UNKNOWN' } });
    }
  }

  const phone = donation.donor.phoneMasked;

  if (!approved) {
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

  // 승인 성공
  const fees = await calculateFees(donation.creatorId, donation.amount);
  await prisma.$transaction([
    prisma.paymentTransaction.update({
      where: { id: txn.id },
      data: { status: 'APPROVED', providerTid: approved.providerTid, approvedAt: approved.approvedAt },
    }),
    prisma.donation.update({
      where: { id: donationId },
      data: {
        status: 'PAYMENT_SUCCESS',
        paidAt: approved.approvedAt,
        pgFee: fees.pgFee,
        platformFee: fees.platformFee,
        netAmount: fees.net,
      },
    }),
    prisma.donationStatusLog.create({
      data: { id: newId(), donationId, fromStatus: 'PENDING_PAYMENT', toStatus: 'PAYMENT_SUCCESS', actor: 'system' },
    }),
    prisma.donorCreatorLink.upsert({
      where: { donorId_creatorId: { donorId: donation.donorId!, creatorId: donation.creatorId } },
      create: {
        id: newId(), donorId: donation.donorId!, creatorId: donation.creatorId,
        consentedAt: new Date(), totalAmount: donation.amount, totalCount: 1, lastDonatedAt: approved.approvedAt,
      },
      update: {
        totalAmount: { increment: donation.amount },
        totalCount: { increment: 1 },
        lastDonatedAt: approved.approvedAt,
      },
    }),
  ]);

  await commitCounters(donation.donorId!, donation.creatorId, donation.amount, approved.approvedAt);
  await clearFailures(donation.donorId!);
  await postDonationSettlement({
    creatorId: donation.creatorId,
    donationId,
    amount: donation.amount,
    fees,
    occurredAt: approved.approvedAt,
  });
  await setStatus(donationId, 'SETTLEMENT_PENDING', '정산 대기');

  // 누적 후원금 안내
  const link = await prisma.donorCreatorLink.findUnique({
    where: { donorId_creatorId: { donorId: donation.donorId!, creatorId: donation.creatorId } },
    select: { totalAmount: true },
  });
  await sendMtForDonor(
    donation.donorId!,
    tpl.tplDonationSuccess({
      creatorName: donation.creator.displayName,
      amount: donation.amount,
      message: donation.message,
      cumulative: link?.totalAmount ?? donation.amount,
    }),
    donationId,
    donation.creatorId,
  );

  // 결제 성공 이후에만 방송 전송을 시도한다.
  await dispatchBroadcast(donationId);

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
