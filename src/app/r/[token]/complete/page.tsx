import type { Metadata } from 'next';
import Link from 'next/link';
import { CircleCheck, CircleX, Landmark, MessageSquare, RefreshCw, ShieldCheck } from 'lucide-react';
import { Card, CardTitle, DataRow, LinkButton, Notice } from '@/components/ui';
import { prisma } from '@/server/db';
import { completeRegistrationAction } from '@/app/actions/registration';
import { LinkShell } from '../link-shell';

/**
 * 결제창(현재는 Mock) 복귀 처리 화면.
 *
 * 주의
 *  - completeRegistration 은 보안링크를 1회용으로 소비한다.
 *    이미 완료된 등록이면 다시 실행하지 않고 결과만 안내한다.
 *  - 계좌번호 원문은 저장하지도, 화면에 노출하지도 않는다. 은행명 + 끝 4자리만 표시한다.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '도네이도 계좌 등록 결과',
  robots: { index: false, follow: false },
};

type Search = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? '';
  return v ?? '';
}

export default async function RegistrationCompletePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Search>;
}) {
  const { token } = await params;
  const sp = await searchParams;

  const registrationId = one(sp.registrationId) || one(sp.ref);
  const tid = one(sp.tid);
  const bankCode = one(sp.bankCode);
  const bankName = one(sp.bankName);
  const account = one(sp.account);
  const failed = one(sp.fail) === '1' || one(sp.result) === 'FAIL';
  const failMessage = one(sp.message);

  if (!registrationId) {
    return (
      <LinkShell>
        <FailCard
          token={token}
          title="등록 정보를 확인할 수 없습니다"
          message="결제창에서 전달된 등록 정보가 없습니다. 처음부터 다시 시도해 주세요."
        />
      </LinkShell>
    );
  }

  const registration = await prisma.paymentRegistration.findUnique({ where: { id: registrationId } });
  if (!registration) {
    return (
      <LinkShell>
        <FailCard
          token={token}
          title="등록 정보를 찾을 수 없습니다"
          message="등록 요청이 만료되었거나 존재하지 않습니다. 크리에이터 번호로 문자를 다시 보내주세요."
        />
      </LinkShell>
    );
  }

  // 인증 실패로 복귀한 경우: 링크를 소비하지 않고 재시도를 안내한다.
  if (failed) {
    if (registration.status !== 'COMPLETED') {
      await prisma.paymentRegistration.update({
        where: { id: registration.id },
        data: {
          status: 'FAILED',
          resultCode: one(sp.code) || 'AUTH_FAILED',
          resultMessage: failMessage || '계좌 인증에 실패했습니다.',
        },
      });
    }
    return (
      <LinkShell>
        <FailCard
          token={token}
          title="계좌 인증이 완료되지 않았습니다"
          message={failMessage || '계좌 인증에 실패했습니다. 입력한 정보와 계좌 상태를 확인한 뒤 다시 시도해 주세요.'}
        />
      </LinkShell>
    );
  }

  // 이미 완료된 등록이면 재실행하지 않는다(1회용 링크 보호).
  let ok = registration.status === 'COMPLETED';
  let message: string | undefined;
  let resultBankName: string | null = null;
  let resultTail4: string | null = null;

  if (ok) {
    const active = await prisma.paymentMethodToken.findFirst({
      where: { donorId: registration.donorId, status: 'ACTIVE' },
      orderBy: { registeredAt: 'desc' },
      select: { bankName: true, accountTail4: true },
    });
    resultBankName = active?.bankName ?? null;
    resultTail4 = active?.accountTail4 ?? null;
  } else {
    const res = await completeRegistrationAction({
      token,
      registrationId: registration.id,
      providerPayload: { tid, bankCode, bankName, account },
    });
    ok = res.ok;
    message = res.message;
    resultBankName = res.bankName ?? null;
    resultTail4 = res.accountTail4 ?? null;
  }

  if (!ok) {
    return (
      <LinkShell>
        <FailCard
          token={token}
          title="계좌 등록에 실패했습니다"
          message={message ?? '계좌 등록을 완료하지 못했습니다.'}
        />
      </LinkShell>
    );
  }

  const creator = registration.creatorId
    ? await prisma.creatorProfile.findUnique({
        where: { id: registration.creatorId },
        select: { code: true, displayName: true },
      })
    : null;

  const moNumber = registration.creatorId
    ? await prisma.creatorMoNumber.findFirst({
        where: { creatorId: registration.creatorId, status: 'ASSIGNED' },
        select: { phoneNumber: true, keyword: true },
      })
    : null;

  return (
    <LinkShell>
      <div className="space-y-3">
        <Card>
          <div className="flex items-center gap-2 text-success-500">
            <CircleCheck size={20} strokeWidth={1.7} />
            <p className="text-[17px] font-extrabold text-ink-900">계좌 등록이 완료되었습니다</p>
          </div>
          <div className="mt-3">
            <DataRow
              label="등록 계좌"
              value={
                <span className="inline-flex items-center gap-1.5">
                  <Landmark size={14} strokeWidth={1.7} className="text-brand-700" />
                  {resultBankName ?? '등록 은행'} {resultTail4 ? `****${resultTail4}` : ''}
                </span>
              }
            />
            {creator ? <DataRow label="후원 대상" value={creator.displayName} /> : null}
            {moNumber ? (
              <DataRow
                label="후원 번호"
                value={
                  <span>
                    {moNumber.phoneNumber}
                    {moNumber.keyword ? <span className="text-ink-400"> ({moNumber.keyword} 로 시작)</span> : null}
                  </span>
                }
              />
            ) : null}
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-400">
            계좌번호 원문은 도네이도에 저장되지 않습니다. 은행명과 끝 4자리만 보관합니다.
          </p>
        </Card>

        <Notice tone="brand" title="이제 같은 번호로 문자를 보내면 후원이 접수됩니다">
          문자를 보내면 확인 링크가 발송되고, 확인 버튼을 누르면 등록한 계좌에서 후원금이 출금됩니다. 문자 1건마다
          출금이 요청되니 반복 발송에 주의해 주세요.
        </Notice>

        {moNumber ? (
          <a
            href={`sms:${moNumber.phoneNumber}?body=${encodeURIComponent(moNumber.keyword ? `${moNumber.keyword} 응원합니다!` : '응원합니다!')}`}
            className="inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-brand-400 text-[15.5px] font-extrabold text-ink-900 shadow-[0_8px_20px_rgba(237,166,0,0.28)] transition-colors hover:bg-brand-500"
          >
            <MessageSquare size={17} strokeWidth={1.7} />
            바로 문자 보내러 가기
          </a>
        ) : null}

        {creator ? (
          <LinkButton href={`/c/${creator.code}`} size="lg" variant="secondary">
            <MessageSquare size={17} strokeWidth={1.7} />
            {creator.displayName} 후원샵 보기
          </LinkButton>
        ) : null}

        <Card>
          <div className="mb-2 flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-ink-50 text-brand-700">
              <ShieldCheck size={17} strokeWidth={1.7} />
            </span>
            <CardTitle>자동출금 해지 방법</CardTitle>
          </div>
          <ul className="space-y-2 text-[13px] leading-relaxed text-ink-700">
            <li>마이페이지의 결제수단 관리에서 등록한 계좌를 해지하면 이후 문자 후원이 진행되지 않습니다.</li>
            <li>고객센터로 해지를 요청하셔도 즉시 처리됩니다.</li>
            <li>해지 후에는 문자를 보내도 결제가 진행되지 않으며, 다시 이용하려면 계좌를 새로 등록해야 합니다.</li>
          </ul>
          <div className="mt-3 flex items-center gap-4">
            <Link href="/my/payments" className="text-[13px] font-semibold text-brand-700">
              결제수단 관리
            </Link>
            <Link href="/support" className="text-[13px] font-semibold text-brand-700">
              고객센터 문의하기
            </Link>
          </div>
        </Card>
      </div>
    </LinkShell>
  );
}

function FailCard({ token, title, message }: { token: string; title: string; message: string }) {
  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-center gap-2 text-danger-500">
          <CircleX size={20} strokeWidth={1.7} />
          <p className="text-[16px] font-extrabold text-ink-900">{title}</p>
        </div>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-700">{message}</p>
        <div className="mt-3">
          <Notice tone="warning" title="출금은 발생하지 않았습니다">
            계좌 등록이 완료되지 않았으므로 어떠한 출금도 발생하지 않습니다. 등록 링크가 아직 유효하면 아래에서 다시
            시도할 수 있습니다.
          </Notice>
        </div>
      </Card>
      <LinkButton href={`/r/${token}`} size="lg" variant="secondary">
        <RefreshCw size={17} strokeWidth={1.7} />
        등록 다시 시도하기
      </LinkButton>
      <p className="text-center text-[12px] leading-relaxed text-ink-400">
        링크가 만료되었다면 크리에이터 번호로 문자를 다시 보내주세요.
      </p>
    </div>
  );
}
