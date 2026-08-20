import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/layout/console-shell';
import { Badge, Card, DataRow, Notice, SectionTitle } from '@/components/ui';
import { AdminField, AdminTextarea } from '@/components/admin/controls';
import { ActionButton, ActionForm } from '@/components/admin/action-form';
import { replyInquiry, setInquiryStatus, markInquiryRead } from '@/app/actions/admin/inquiries';
import { prisma } from '@/server/db';
import { formatKst } from '@/lib/datetime';
import { cx } from '@/components/ui';
import type { InquiryStatus } from '@/generated/prisma/enums';
import { requireAdmin } from '@/server/auth';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<InquiryStatus, { text: string; tone: 'warning' | 'success' | 'neutral' }> = {
  OPEN: { text: '답변 대기', tone: 'warning' },
  ANSWERED: { text: '답변 완료', tone: 'success' },
  CLOSED: { text: '종결', tone: 'neutral' },
};

export default async function AdminInquiryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (admin.adminPermission !== 'SUPER_ADMIN') redirect('/admin');
  const { id } = await params;

  const inquiry = await prisma.supportInquiry.findUnique({
    where: { id },
    select: {
      id: true, userId: true, guestName: true, contactMasked: true, category: true, status: true,
      createdAt: true, lastMessageAt: true,
      messages: { orderBy: { createdAt: 'asc' }, take: 300, select: { id: true, sender: true, body: true, createdAt: true } },
    },
  });
  if (!inquiry) notFound();

  await markInquiryRead(inquiry.id);

  const user = inquiry.userId
    ? await prisma.user.findUnique({
        where: { id: inquiry.userId },
        select: { id: true, name: true, email: true, role: true, phoneMasked: true },
      })
    : null;

  const label = STATUS_LABEL[inquiry.status];

  return (
    <>
      <PageHeader
        title={`문의 상세 · ${user ? (user.name ?? user.email ?? '회원') : (inquiry.guestName || '비회원')}`}
        description={`접수 ${formatKst(inquiry.createdAt)} · 최근 활동 ${formatKst(inquiry.lastMessageAt)}`}
        action={
          <Link href="/admin/inquiries" className="rounded-lg border border-ink-200 px-3 py-1.5 text-[12px] font-semibold text-ink-700">
            목록으로
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionTitle title="대화 내용" />
          <Card>
            {inquiry.messages.length === 0 ? (
              <p className="text-[13px] text-ink-400">메시지가 없습니다.</p>
            ) : (
              <div className="space-y-2.5">
                {inquiry.messages.map((m) => (
                  <div key={m.id} className={cx('flex', m.sender === 'ADMIN' ? 'justify-end' : 'justify-start')}>
                    <div
                      className={cx(
                        'max-w-[78%] rounded-2xl px-3.5 py-2.5',
                        m.sender === 'ADMIN' ? 'bg-brand-100 text-ink-900' : 'bg-ink-50 text-ink-900',
                      )}
                    >
                      <p className="whitespace-pre-line break-words text-[13px] leading-relaxed">{m.body}</p>
                      <p className="mt-1 text-[10.5px] tabular-nums text-ink-400">
                        {m.sender === 'ADMIN' ? '관리자' : '문의자'} · {formatKst(m.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 border-t border-ink-100 pt-4">
              <ActionForm action={replyInquiry} submitLabel="답변 등록" confirm="답변을 등록합니다. 사용자 문의 창에 바로 표시됩니다.">
                <input type="hidden" name="inquiryId" value={inquiry.id} />
                <AdminField label="답변 내용">
                  <AdminTextarea name="body" rows={4} placeholder="답변을 입력해 주세요 (2,000자 이내)" required />
                </AdminField>
              </ActionForm>
            </div>
          </Card>
        </div>

        <div>
          <SectionTitle title="문의자 정보" />
          <Card>
            <div>
              <DataRow label="상태" value={<Badge tone={label.tone}>{label.text}</Badge>} />
              <DataRow label="문의 유형" value={inquiry.category} />
              {user ? (
                <>
                  <DataRow label="이름" value={user.name ?? '-'} />
                  <DataRow label="이메일" value={user.email ?? '-'} />
                  <DataRow label="연락처" value={user.phoneMasked ?? '-'} />
                  <DataRow label="역할" value={user.role} />
                </>
              ) : (
                <>
                  <DataRow label="구분" value="비회원 (게스트)" />
                  <DataRow label="이름" value={inquiry.guestName ?? '-'} />
                  <DataRow label="회신 연락처" value={inquiry.contactMasked ?? '미입력'} />
                </>
              )}
            </div>
            <div className="mt-3 flex flex-col gap-1.5">
              {inquiry.status !== 'CLOSED' ? (
                <ActionButton
                  action={setInquiryStatus}
                  values={{ inquiryId: inquiry.id, status: 'CLOSED' }}
                  label="문의 종결"
                  variant="danger"
                  confirm="이 문의를 종결 처리합니다. 사용자가 새 메시지를 보내면 다시 접수됩니다."
                />
              ) : (
                <ActionButton
                  action={setInquiryStatus}
                  values={{ inquiryId: inquiry.id, status: 'OPEN' }}
                  label="다시 열기"
                  confirm="이 문의를 다시 답변 대기 상태로 되돌립니다."
                />
              )}
            </div>
            <div className="mt-3">
              <Notice tone="neutral">
                회신 연락처는 마스킹된 값만 표시됩니다. 답변은 이 화면에서 등록하면 사용자 문의 창에 실시간으로
                전달됩니다.
              </Notice>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
