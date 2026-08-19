import { prisma } from '@/server/db';
import { newId } from '@/lib/id';
import { encrypt, maskSecret } from '@/lib/crypto';
import { env } from '@/lib/env';
import { getPaymentAdapter } from '@/server/adapters/payment';
import { resolveSecureLink, consumeSecureLink } from './secure-link';
import type { ConsentType } from '@/generated/prisma/enums';

/**
 * 후원자 계좌 등록 (헥토 내통장결제 0원 인증 후 빌키 발급 흐름).
 *
 * 저장 규칙
 *  - 계좌번호 원문과 인증정보는 토네이도 DB 에 저장하지 않는다.
 *  - 은행명과 계좌 끝 4자리, 암호화된 빌키만 보관한다.
 */

export interface RegistrationContext {
  linkId: string;
  donorId: string;
  creatorId: string | null;
  creatorName: string | null;
  donationAmount: bigint;
  phoneMasked: string;
}

export async function loadRegistrationContext(token: string): Promise<
  { ok: true; ctx: RegistrationContext } | { ok: false; reason: string }
> {
  const res = await resolveSecureLink(token);
  if (!res.ok) {
    const reason =
      res.reason === 'EXPIRED' ? '링크가 만료되었습니다. 크리에이터 번호로 문자를 다시 보내주세요.'
      : res.reason === 'USED' ? '이미 사용된 링크입니다.'
      : '유효하지 않은 링크입니다.';
    return { ok: false, reason };
  }
  const link = res.link!;
  if (link.purpose !== 'REGISTER_ACCOUNT') return { ok: false, reason: '용도가 다른 링크입니다.' };

  const donor = await prisma.donorProfile.findUnique({ where: { phoneHash: link.phoneHash } });
  if (!donor) return { ok: false, reason: '후원자 정보를 찾을 수 없습니다.' };

  const creator = link.creatorId
    ? await prisma.creatorProfile.findUnique({ where: { id: link.creatorId } })
    : null;

  return {
    ok: true,
    ctx: {
      linkId: link.id,
      donorId: donor.id,
      creatorId: creator?.id ?? null,
      creatorName: creator?.displayName ?? null,
      donationAmount: creator?.donationAmount ?? 3000n,
      phoneMasked: donor.phoneMasked,
    },
  };
}

export interface ConsentInput {
  type: ConsentType;
  agreed: boolean;
}

/** 결제창 세션 생성. 필수 동의가 모두 있어야 진행한다. */
export async function startRegistration(input: {
  token: string;
  consents: ConsentInput[];
  ip?: string;
  userAgent?: string;
}) {
  const loaded = await loadRegistrationContext(input.token);
  if (!loaded.ok) throw new Error(loaded.reason);
  const { ctx } = loaded;

  const requiredTerms = await prisma.termsVersion.findMany({ where: { active: true, required: true } });
  const agreedTypes = new Set(input.consents.filter((c) => c.agreed).map((c) => c.type));
  const missing = requiredTerms.filter((t) => !agreedTypes.has(t.type));
  if (missing.length > 0) {
    throw new Error(`필수 동의 항목이 누락되었습니다: ${missing.map((m) => m.title).join(', ')}`);
  }

  const donor = await prisma.donorProfile.findUnique({ where: { id: ctx.donorId } });
  if (!donor) throw new Error('후원자 정보를 찾을 수 없습니다.');

  // 동의 이력 저장 (약관 버전 포함)
  const allTerms = await prisma.termsVersion.findMany({ where: { active: true } });
  for (const c of input.consents) {
    const terms = allTerms.find((t) => t.type === c.type);
    if (!terms) continue;
    await prisma.consentRecord.create({
      data: {
        id: newId(),
        phoneHash: donor.phoneHash,
        userId: donor.userId ?? null,
        termsId: terms.id,
        type: c.type,
        agreed: c.agreed,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  }

  const registration = await prisma.paymentRegistration.create({
    data: {
      id: newId(),
      donorId: ctx.donorId,
      creatorId: ctx.creatorId,
      provider: env.payment.provider,
    },
  });

  const adapter = getPaymentAdapter();
  const session = await adapter.createRegistrationSession({
    donorRef: registration.id,
    returnUrl: `${env.baseUrl}/r/${input.token}/complete`,
    notifyUrl: `${env.baseUrl}/api/payments/notify`,
  });
  if (!session.ok || !session.data) throw new Error(session.message ?? '결제창 생성에 실패했습니다.');

  await prisma.paymentRegistration.update({
    where: { id: registration.id },
    data: { status: 'AUTH_DONE', providerTid: session.data.providerTid },
  });

  return { registrationId: registration.id, redirectUrl: session.data.redirectUrl, ctx };
}

/** 결제창 콜백 처리 → 빌키 저장. 계좌 원문은 저장하지 않는다. */
export async function completeRegistration(input: {
  token: string;
  registrationId: string;
  providerPayload: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}) {
  const loaded = await loadRegistrationContext(input.token);
  if (!loaded.ok) throw new Error(loaded.reason);
  const { ctx } = loaded;

  const adapter = getPaymentAdapter();
  const res = await adapter.completeRegistration(input.providerPayload);

  if (!res.ok || !res.data) {
    await prisma.paymentRegistration.update({
      where: { id: input.registrationId },
      data: { status: 'FAILED', resultCode: res.code ?? null, resultMessage: res.message ?? null },
    });
    throw new Error(res.message ?? '계좌 등록에 실패했습니다.');
  }

  // 기존 활성 결제수단은 폐기 (활성 1건 유지)
  await prisma.paymentMethodToken.updateMany({
    where: { donorId: ctx.donorId, status: 'ACTIVE' },
    data: { status: 'REVOKED', revokedAt: new Date() },
  });

  const token = await prisma.paymentMethodToken.create({
    data: {
      id: newId(),
      donorId: ctx.donorId,
      provider: env.payment.provider,
      billKeyEnc: encrypt(res.data.billKey),
      billKeyHint: maskSecret(res.data.billKey),
      bankCode: res.data.bankCode ?? null,
      bankName: res.data.bankName ?? null,
      accountTail4: res.data.accountTail4 ?? null,
    },
  });

  await prisma.paymentRegistration.update({
    where: { id: input.registrationId },
    data: { status: 'COMPLETED', providerTid: res.data.providerTid, completedAt: new Date() },
  });

  await prisma.donorProfile.update({
    where: { id: ctx.donorId },
    data: { registeredAt: new Date(), ageVerified: true },
  });

  if (ctx.creatorId) {
    await prisma.donorCreatorLink.upsert({
      where: { donorId_creatorId: { donorId: ctx.donorId, creatorId: ctx.creatorId } },
      create: { id: newId(), donorId: ctx.donorId, creatorId: ctx.creatorId, consentedAt: new Date() },
      update: { consentedAt: new Date() },
    });
  }

  // 링크는 1회만 사용 가능
  await consumeSecureLink(ctx.linkId, input.ip, input.userAgent);

  return { tokenId: token.id, bankName: token.bankName, accountTail4: token.accountTail4 };
}

/** 자동출금 동의 해지 = 등록 결제수단 폐기 */
export async function revokePaymentMethod(donorId: string) {
  const active = await prisma.paymentMethodToken.findFirst({ where: { donorId, status: 'ACTIVE' } });
  if (!active) return false;
  const adapter = getPaymentAdapter();
  await adapter.revokeBillKey(active.billKeyEnc).catch(() => undefined);
  await prisma.paymentMethodToken.update({
    where: { id: active.id },
    data: { status: 'REVOKED', revokedAt: new Date() },
  });
  return true;
}
