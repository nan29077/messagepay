import { Badge, Card, CardTitle, DataRow, Field, Input, LinkButton, Notice, SectionTitle, Select } from '@/components/ui';
import { PageHeader } from '@/components/layout/console-shell';
import { ActionForm } from '@/components/studio/action-form';
import { BANKS } from '@/components/studio/banks';
import { saveSettlementAccountAction } from '@/app/actions/studio';
import { requireCreator } from '@/server/auth';
import { prisma } from '@/server/db';
import { formatKst } from '@/lib/datetime';

export const dynamic = 'force-dynamic';

export default async function StudioSettlementAccountPage() {
  const { creatorId } = await requireCreator();

  const account = await prisma.settlementAccount.findUnique({
    where: { creatorId },
    select: {
      bankCode: true,
      bankName: true,
      accountTail4: true,
      holderMasked: true,
      verified: true,
      verifiedAt: true,
      updatedAt: true,
    },
  });

  return (
    <>
      <PageHeader
        title="정산 계좌"
        description="정산금을 지급받을 계좌입니다."
        action={
          <LinkButton href="/studio/settlement" variant="secondary" size="sm">
            정산 관리로
          </LinkButton>
        }
      />

      <div className="space-y-5">
        <Notice tone="warning" title="계좌 실명확인은 아직 mock 단계입니다">
          현재 예금주 실명확인 API와 계약되어 있지 않아, 계좌를 저장해도 자동으로 인증되지 않습니다. 등록된 계좌는
          통합 관리자가 확인한 뒤 인증 상태로 전환되며, 인증 전에는 정산을 요청할 수 없습니다.
        </Notice>

        <section>
          <SectionTitle title="등록된 계좌" />
          <Card>
            {account ? (
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <CardTitle>{account.bankName}</CardTitle>
                  {account.verified ? <Badge tone="success">인증 완료</Badge> : <Badge tone="warning">인증 대기</Badge>}
                </div>
                <DataRow label="은행" value={account.bankName} />
                <DataRow label="계좌번호" value={`****${account.accountTail4}`} />
                <DataRow label="예금주" value={account.holderMasked} />
                <DataRow label="마지막 수정" value={formatKst(account.updatedAt)} />
                <DataRow label="인증 시각" value={formatKst(account.verifiedAt)} />
                <p className="mt-2 text-[12px] leading-relaxed text-ink-400">
                  보안을 위해 계좌번호와 예금주는 암호화되어 저장되며, 화면에는 은행명과 끝 4자리만 표시됩니다.
                </p>
              </div>
            ) : (
              <Notice tone="neutral">등록된 정산 계좌가 없습니다. 아래에서 계좌를 등록해 주세요.</Notice>
            )}
          </Card>
        </section>

        <section>
          <SectionTitle
            title={account ? '계좌 변경' : '계좌 등록'}
            description="계좌를 변경하면 인증 상태가 초기화되어 다시 관리자 확인을 거칩니다."
          />
          <Card>
            <ActionForm action={saveSettlementAccountAction} submitLabel={account ? '계좌 변경' : '계좌 등록'}>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="은행" required>
                  <Select name="bankCode" defaultValue={account?.bankCode ?? '004'}>
                    {BANKS.map((b) => (
                      <option key={b.code} value={b.code}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="예금주" hint="사업자 계좌라면 사업자명과 동일해야 합니다." required>
                  <Input name="holderName" maxLength={30} placeholder="예금주명" autoComplete="off" />
                </Field>
              </div>
              <Field label="계좌번호" hint="숫자만 입력해 주세요. (8~20자리)" required>
                <Input
                  name="account"
                  inputMode="numeric"
                  maxLength={24}
                  placeholder="- 없이 숫자만"
                  autoComplete="off"
                  className="tabular-nums"
                />
              </Field>
            </ActionForm>
          </Card>
        </section>

        <Notice tone="neutral">
          정산금은 원천징수 3.3%를 차감한 뒤 등록된 계좌로 지급됩니다. 원천징수 세율은 세무 검토 후 확정됩니다.
          예금주와 크리에이터 명의가 다르면 지급이 보류될 수 있습니다.
        </Notice>
      </div>
    </>
  );
}
