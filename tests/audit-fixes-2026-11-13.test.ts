import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/server/db';
import { newId } from '@/lib/id';
import { readMockOutbox } from '@/server/adapters/mt';
import {
  loadDocumentContext, parseDocumentFields, submissionView, submitDocument,
} from '@/server/services/documents';
import { inboundAndPay, moPayload, resetDb, seedBasics, seedRegisteredPayer, type Fixture } from './helpers';

/**
 * 2026-11-13 전체 점검 수정분 회귀 테스트.
 *
 * 문서 상품(2026-09-18 추가)은 지금까지 테스트가 하나도 없었다.
 * 결제 → 작성 링크 → 제출 → 확인까지의 흐름과 이번에 고친 지점을 함께 묶는다.
 * 제목의 번호는 docs/2026-11-13_전체점검_수정보고서.md 의 항목 번호다.
 */

// 서버 액션은 Next 요청 컨텍스트 밖에서 돈다. 세션 대신 테스트 가맹점을 돌려주고,
// revalidatePath 는 요청 저장소가 없으면 던지므로 비워 둔다.
let currentMerchant: { id: string; merchantId: string } | null = null;
vi.mock('@/server/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth')>();
  return {
    ...actual,
    requireMerchant: async () => {
      if (!currentMerchant) throw new Error('가맹점 권한이 필요합니다.');
      return { ...currentMerchant, role: 'MERCHANT', merchantStatus: 'APPROVED' };
    },
  };
});
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7', 'user-agent': 'vitest' }),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));

const initial = { ok: false } as const;

async function seedDocumentProduct(fx: Fixture, opts: { requireSignature?: boolean } = {}) {
  const template = await prisma.documentTemplate.create({
    data: {
      id: newId(),
      merchantId: fx.merchantId,
      name: '후원약정서',
      templateType: 'EDITOR',
      body: '제1조 이 약정서는 후원 내용을 정합니다.',
      fields: [
        { id: 'name', label: '성명', type: 'TEXT', required: true, hint: null },
        { id: 'amount', label: '약정 금액(원)', type: 'NUMBER', required: true, hint: null },
        { id: 'agree', label: '개인정보 수집에 동의합니다', type: 'CHECKBOX', required: true, hint: null },
      ],
      requireSignature: opts.requireSignature ?? false,
      active: true,
    },
  });
  const product = await prisma.chargeProduct.create({
    data: {
      id: newId(),
      merchantId: fx.merchantId,
      kind: 'DOCUMENT',
      name: '정기후원 약정',
      amount: 10000,
      sortOrder: -1, // 시드 기본 상품보다 앞에 둬서 selectChargeAmount 가 이 상품을 고르게 한다
      documentTemplateId: template.id,
    },
  });
  return { template, product };
}

function lastDocumentToken(): string | null {
  const mt = readMockOutbox(20).find((m) => m.template === 'DOCUMENT_REQUEST');
  const m = mt?.text.match(/\/doc\/([A-Za-z0-9_-]+)/);
  return m ? m[1]! : null;
}

async function payForDocument(fx: Fixture) {
  const res = await inboundAndPay(moPayload({ to: fx.moNumber, from: fx.payerPhone }), fx.merchantId);
  expect(['PAYMENT_SUCCESS', 'SETTLEMENT_PENDING']).toContain(res.status);
  const token = lastDocumentToken();
  expect(token).toBeTruthy();
  return { chargeId: res.chargeId!, token: token! };
}

describe('문서 상품 — 결제부터 제출까지', () => {
  let fx: Fixture;
  beforeEach(async () => {
    await resetDb();
    fx = await seedBasics({ paymentMode: 'CONFIRM_LINK' });
    await seedRegisteredPayer(fx.payerPhone);
    currentMerchant = { id: fx.merchantUserId, merchantId: fx.merchantId };
  });

  it('결제가 끝나면 작성 기록이 생기고 작성 링크 문자가 나간다', async () => {
    await seedDocumentProduct(fx);
    const { chargeId, token } = await payForDocument(fx);

    const sub = await prisma.documentSubmission.findUnique({ where: { chargeId } });
    expect(sub?.status).toBe('DRAFT');
    const charge = await prisma.charge.findUnique({ where: { id: chargeId }, select: { pointStatus: true } });
    // 문서 상품은 지급 대기 목록에 섞이지 않는다.
    expect(charge?.pointStatus).toBe('SKIPPED');

    const loaded = await loadDocumentContext(token);
    expect(loaded.ok).toBe(true);
  });

  it('[D-1] 제출 당시 항목·본문을 남겨, 서식을 고쳐도 제출본은 바뀌지 않는다', async () => {
    const { template } = await seedDocumentProduct(fx);
    const { token } = await payForDocument(fx);

    const bad = await submitDocument({ token, values: { name: '홍길동', amount: '50000' } });
    expect(bad.ok).toBe(false); // 필수 동의 누락

    const ok = await submitDocument({ token, values: { name: '홍길동', amount: '50,000', agree: 'on' } });
    expect(ok.ok).toBe(true);

    // 가맹점이 서식을 고친다: 항목 이름을 바꾸고 하나를 지우고 본문도 바꾼다.
    await prisma.documentTemplate.update({
      where: { id: template.id },
      data: {
        name: '새 약정서',
        body: '완전히 다른 본문',
        fields: [{ id: 'nickname', label: '닉네임', type: 'TEXT', required: true, hint: null }],
      },
    });

    const after = await loadDocumentContext(token);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.ctx.templateName).toBe('후원약정서');
    expect(after.ctx.body).toBe('제1조 이 약정서는 후원 내용을 정합니다.');
    expect(after.ctx.fields.map((f) => f.label)).toEqual(['성명', '약정 금액(원)', '개인정보 수집에 동의합니다']);
    expect(after.ctx.values).toMatchObject({ name: '홍길동', amount: '50000', agree: 'Y' });

    const again = await submitDocument({ token, values: { name: '김철수', amount: '1', agree: 'on' } });
    expect(again.ok).toBe(false);
  });

  it('[D-1] 스냅숏이 없는 예전 제출 건과 작성 대기 건은 현재 서식으로 그린다', () => {
    const template = { name: '현재', body: '현재 본문', fields: [{ id: 'a', label: '가', type: 'TEXT' }] };
    const legacy = submissionView({ status: 'SUBMITTED', fieldsSnapshot: null }, template);
    expect(legacy.fromSnapshot).toBe(false);
    expect(legacy.fields[0]?.label).toBe('가');

    const draft = submissionView(
      { status: 'DRAFT', fieldsSnapshot: [{ id: 'b', label: '나', type: 'TEXT' }], bodySnapshot: '옛 본문' },
      template,
    );
    expect(draft.body).toBe('현재 본문');
    expect(draft.fields[0]?.label).toBe('가');
  });

  it('[D-3] 확인 완료는 한 번만 찍힌다', async () => {
    const { markDocumentReviewedAction } = await import('@/app/actions/studio-documents');
    await seedDocumentProduct(fx);
    const { chargeId, token } = await payForDocument(fx);
    await submitDocument({ token, values: { name: '홍길동', amount: '1000', agree: 'on' } });
    const sub = await prisma.documentSubmission.findUniqueOrThrow({ where: { chargeId } });

    const fd = () => {
      const f = new FormData();
      f.set('submissionId', sub.id);
      return f;
    };
    const [a, b] = await Promise.all([markDocumentReviewedAction(initial, fd()), markDocumentReviewedAction(initial, fd())]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });

  it('[D-4] 작성 링크 재발송은 문서당 한 시간 3번까지, 제출된 문서는 재발송하지 않는다', async () => {
    const { resendDocumentLinkAction } = await import('@/app/actions/studio-documents');
    await seedDocumentProduct(fx);
    const { chargeId, token } = await payForDocument(fx);
    const sub = await prisma.documentSubmission.findUniqueOrThrow({ where: { chargeId } });
    const fd = () => {
      const f = new FormData();
      f.set('submissionId', sub.id);
      return f;
    };

    for (let i = 0; i < 3; i += 1) {
      const r = await resendDocumentLinkAction(initial, fd());
      expect(r).toMatchObject({ ok: true });
    }
    const blocked = await resendDocumentLinkAction(initial, fd());
    expect(blocked.ok).toBe(false);

    // 재발송으로 예전 링크는 무효가 됐다. 새 링크로 제출한 뒤에는 재발송이 거절된다.
    expect((await loadDocumentContext(token)).ok).toBe(false);
    const fresh = lastDocumentToken()!;
    expect((await submitDocument({ token: fresh, values: { name: '홍길동', amount: '1', agree: 'on' } })).ok).toBe(true);
  });

  it('[D-5] 파일 서식 주소는 자체 업로드 경로만 받는다', async () => {
    const { createDocumentTemplateAction } = await import('@/app/actions/studio-documents');
    const make = (fileUrl: string, name: string) => {
      const f = new FormData();
      f.set('templateType', 'FILE');
      f.set('name', name);
      f.set('fileUrl', fileUrl);
      f.set('fileName', '약정서.pdf');
      return f;
    };

    const external = await createDocumentTemplateAction(initial, make('https://evil.example.com/a.pdf', '외부'));
    expect(external.ok).toBe(false);
    const traversal = await createDocumentTemplateAction(initial, make('/api/media/../../etc/passwd', '경로'));
    expect(traversal.ok).toBe(false);

    const own = await createDocumentTemplateAction(
      initial,
      make(`/api/media/${'a'.repeat(32)}.pdf`, '자체'),
    );
    expect(own.ok).toBe(true);
  });
});

describe('[D-2] 입력 항목 id 정규화', () => {
  it('겹치는 id 를 만들어도 끝나고, 모든 id 가 서로 다르다', () => {
    const long = 'a'.repeat(30);
    const raw = [
      { id: long, label: '1' },
      { id: long, label: '2' },
      { id: `${long.slice(0, 26)}_2`, label: '3' },
      { id: long, label: '4' },
      { id: 'x', label: '5' },
      { id: 'x', label: '6' },
      { id: 'x_2', label: '7' },
    ];
    const fields = parseDocumentFields(raw);
    expect(fields).toHaveLength(7);
    expect(new Set(fields.map((f) => f.id)).size).toBe(7);
  });
});

describe('[P-1] 파트너 API 는 문서 상품의 종류를 바꾸지 못한다', () => {
  it('DOCUMENT → DIGITAL 은 거절하고, 같은 종류·종류 미지정은 통과한다', async () => {
    const { documentKindChangeError } = await import('@/server/services/partner-products');
    expect(documentKindChangeError('DOCUMENT', { kind: 'DIGITAL' })).toBeTruthy();
    expect(documentKindChangeError('DOCUMENT', { name: '이름만' })).toBeNull();
    expect(documentKindChangeError('DOCUMENT', { kind: 'DOCUMENT' })).toBeNull();
    expect(documentKindChangeError('DIGITAL', { kind: 'PHYSICAL' })).toBeNull();
  });
});
