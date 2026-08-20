import { notFound } from 'next/navigation';
import { Badge, Card, CardTitle, DataRow, EmptyState, Field, Input, Notice, SectionTitle, Table, Td, Textarea, Th } from '@/components/ui';
import { PageHeader } from '@/components/layout/console-shell';
import { ActionForm } from '@/components/studio/action-form';
import { updateCreatorProfileAction } from '@/app/actions/studio';
import { requireCreator } from '@/server/auth';
import { prisma } from '@/server/db';
import { formatKst } from '@/lib/datetime';
import { creatorStatusLabel } from '@/lib/labels';

export const dynamic = 'force-dynamic';

export default async function StudioSettingsProfilePage() {
  const { creatorId, email } = await requireCreator();

  const creator = await prisma.creatorProfile.findUnique({
    where: { id: creatorId },
    include: { codes: { orderBy: { issuedAt: 'desc' }, take: 10 } },
  });

  if (!creator) notFound();

  const status = creatorStatusLabel[creator.status];

  return (
    <>
      <PageHeader title="설정" description="채널 프로필과 계정 정보를 관리합니다. 후원샵 꾸미기는 후원 설정 > 후원샵 관리에 있습니다." />

      <div className="space-y-5">
        <section>
          <SectionTitle title="채널 상태" />
          <Card>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <CardTitle>{creator.displayName}</CardTitle>
              <Badge tone={status.tone}>{status.text}</Badge>
            </div>
            <DataRow label="로그인 계정" value={email ?? '-'} />
            <DataRow label="크리에이터 코드" value={<span className="font-mono">{creator.code}</span>} />
            <DataRow label="승인 시각" value={formatKst(creator.approvedAt)} />
            <DataRow label="가입 시각" value={formatKst(creator.createdAt)} />
            {creator.suspendedAt ? <DataRow label="정지 시각" value={formatKst(creator.suspendedAt)} /> : null}
          </Card>
        </section>

        <section>
          <SectionTitle title="프로필 수정" description="후원 페이지와 후원 알림에 표시되는 정보입니다." />
          <Card>
            <ActionForm action={updateCreatorProfileAction} submitLabel="프로필 저장">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="표시명" hint="1~30자" required>
                  <Input name="displayName" maxLength={30} defaultValue={creator.displayName} />
                </Field>
                <Field label="채널명" hint="50자 이내. 비워두면 표시하지 않습니다.">
                  <Input name="channelName" maxLength={50} defaultValue={creator.channelName ?? ''} />
                </Field>
              </div>
              <Field label="소개" hint="300자 이내">
                <Textarea name="description" rows={3} maxLength={300} defaultValue={creator.description ?? ''} />
              </Field>
              <Field
                label="아바타(프로필 캐릭터) URL"
                hint="http(s) 주소 또는 / 로 시작하는 사이트 내 이미지 경로. 비워두면 이름 첫 글자가 표시됩니다."
              >
                <Input name="avatarUrl" defaultValue={creator.avatarUrl ?? ''} placeholder="/avatars-donaido-a-v1.png 또는 https://" />
              </Field>
            </ActionForm>
          </Card>
        </section>

        <section>
          <SectionTitle title="코드 이력" description="코드 발급과 회수는 통합 관리자가 처리합니다." />
          {creator.codes.length === 0 ? (
            <EmptyState title="코드 이력이 없습니다" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>코드</Th>
                  <Th>상태</Th>
                  <Th>발급일</Th>
                  <Th>회수일</Th>
                </tr>
              </thead>
              <tbody>
                {creator.codes.map((c) => (
                  <tr key={c.id}>
                    <Td className="font-mono font-semibold text-ink-900">{c.code}</Td>
                    <Td>
                      <Badge tone={c.active ? 'success' : 'neutral'}>{c.active ? '사용 중' : '회수됨'}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums">{formatKst(c.issuedAt, false)}</Td>
                    <Td className="whitespace-nowrap tabular-nums">{formatKst(c.revokedAt, false)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>

        <Notice tone="neutral">
          표시명과 소개는 후원 페이지에 그대로 노출됩니다. 개인 연락처나 계좌번호 등 개인정보는 입력하지 마세요.
          채널 상태 변경(승인·정지)과 크리에이터 코드 변경은 통합 관리자를 통해서만 가능합니다.
        </Notice>
      </div>
    </>
  );
}
