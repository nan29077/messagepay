import { Landmark, MessageSquare, CreditCard } from 'lucide-react';
import { Card, CardTitle, Badge, EmptyState, Notice, DataRow, LinkButton, SectionTitle } from '@/components/ui';
import { RevokeForm } from '@/components/my/revoke-form';
import { requireDonorContext, NO_DONOR_TITLE, NO_DONOR_DESC } from '@/components/my/donor';
import { prisma } from '@/server/db';
import { formatKst } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

export default async function MyAccountPage() {
  const { donorId } = await requireDonorContext('/my/account');
  if (!donorId) return <EmptyState title={NO_DONOR_TITLE} description={NO_DONOR_DESC} />;

  const tokens = await prisma.paymentMethodToken.findMany({
    where: { donorId },
    orderBy: { registeredAt: 'desc' },
    take: 10,
    select: {
      id: true,
      bankName: true,
      accountTail4: true,
      billKeyHint: true,
      status: true,
      registeredAt: true,
      revokedAt: true,
    },
  });

  const active = tokens.find((t) => t.status === 'ACTIVE') ?? null;
  const history = tokens.filter((t) => t.id !== active?.id);

  return (
    <div className="space-y-5">
      {active ? (
        <Card className="border border-brand-100">
          <div className="flex items-start justify-between gap-3">
            <div className="flex gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
                <Landmark size={18} strokeWidth={1.7} />
              </span>
              <div>
                <CardTitle>등록된 출금 계좌</CardTitle>
                <p className="mt-1 text-[13px] text-ink-500">문자후원 시 이 계좌에서 후원금이 출금됩니다.</p>
              </div>
            </div>
            <Badge tone="success">사용 중</Badge>
          </div>

          <div className="mt-4 rounded-2xl bg-ink-50 px-4 py-4">
            <p className="text-[12px] font-semibold text-ink-400">은행 · 계좌</p>
            <p className="mt-1 text-[20px] font-extrabold tracking-tight text-ink-900">
              {active.bankName ?? '등록 은행'} <span className="font-mono">****{active.accountTail4 ?? '****'}</span>
            </p>
            <p className="mt-1 text-[12px] text-ink-400">
              계좌번호 원문은 저장하지 않으며 끝 4자리만 표시합니다.
            </p>
          </div>

          <div className="mt-3">
            <DataRow label="등록 일시" value={formatKst(active.registeredAt, false)} />
            <DataRow label="결제수단 식별자" value={<span className="font-mono">{active.billKeyHint}</span>} />
            <DataRow label="자동출금 동의" value={<Badge tone="success">동의 중</Badge>} />
          </div>
        </Card>
      ) : (
        <Card>
          <div className="flex gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink-50 text-ink-400">
              <CreditCard size={18} strokeWidth={1.7} />
            </span>
            <div>
              <CardTitle>등록된 계좌가 없습니다</CardTitle>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-500">
                자동출금 동의가 해지되었거나 아직 계좌를 등록하지 않았습니다. 크리에이터의 후원 번호로 문자를 보내면
                등록 안내 문자가 발송됩니다.
              </p>
            </div>
          </div>
        </Card>
      )}

      {active ? (
        <section>
          <SectionTitle
            title="자동출금 동의 해지"
            description="해지하면 등록된 결제수단이 즉시 폐기되고 이후 문자후원이 접수되지 않습니다."
          />
          <Card>
            <Notice tone="warning" title="해지 전에 확인해 주세요">
              <ul className="list-disc space-y-1 pl-4">
                <li>이미 결제가 완료된 후원은 해지와 무관하게 유지됩니다.</li>
                <li>결제 확인을 기다리는 요청이 있다면 해지 후 결제되지 않습니다.</li>
                <li>다시 이용하려면 문자를 보내 계좌를 새로 등록해야 합니다.</li>
              </ul>
            </Notice>
            <div className="mt-4">
              <RevokeForm />
            </div>
          </Card>
        </section>
      ) : (
        <section>
          <SectionTitle title="다시 이용하려면" />
          <Card>
            <div className="flex gap-3">
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
                <MessageSquare size={17} strokeWidth={1.7} />
              </span>
              <div>
                <p className="text-[13.5px] font-bold text-ink-900">문자를 다시 보내주세요</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
                  크리에이터의 후원 번호로 문자를 보내면 계좌 등록용 1회용 보안 링크가 문자로 발송됩니다. 링크에서 계좌
                  등록과 출금이체 동의를 마치면 다시 문자후원을 이용할 수 있습니다. 이때 보낸 문자는 후원으로 접수되지
                  않습니다.
                </p>
                <LinkButton href="/how-it-works" variant="secondary" size="sm" className="mt-2.5">
                  등록 절차 자세히 보기
                </LinkButton>
              </div>
            </div>
          </Card>
        </section>
      )}

      {history.length > 0 ? (
        <section>
          <SectionTitle title="이전 등록 이력" />
          <div className="space-y-2">
            {history.map((t) => (
              <Card key={t.id} className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[13.5px] font-bold text-ink-900">
                      {t.bankName ?? '등록 은행'} <span className="font-mono">****{t.accountTail4 ?? '****'}</span>
                    </p>
                    <p className="mt-0.5 text-[12px] text-ink-400">
                      등록 {formatKst(t.registeredAt, false)}
                      {t.revokedAt ? ` · 해지 ${formatKst(t.revokedAt, false)}` : ''}
                    </p>
                  </div>
                  <Badge tone={t.status === 'REVOKED' ? 'neutral' : 'warning'}>
                    {t.status === 'REVOKED' ? '해지됨' : '만료됨'}
                  </Badge>
                </div>
              </Card>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
