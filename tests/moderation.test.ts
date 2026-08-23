import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/server/db';
import { newId } from '@/lib/id';
import { resetDb, seedBasics, seedRegisteredDonor, moPayload, type Fixture } from './helpers';
import { handleMoInbound, loadBannedWords } from '@/server/services/donation-flow';
import { mockMoAdapter } from '@/server/adapters/mo';
import { filterContent } from '@/server/services/content-filter';

/** 크리에이터 금칙어·차단 기능 검수 */

let fx: Fixture;
const inbound = (p: Record<string, unknown>) => handleMoInbound(mockMoAdapter.parse(p));

beforeEach(async () => {
  await resetDb();
  fx = await seedBasics();
  await seedRegisteredDonor(fx.donorPhone);
});

async function addWord(word: string, action: 'BLOCK' | 'MASK' | 'FLAG', creatorId: string | null) {
  return prisma.bannedWord.create({
    data: {
      id: newId(),
      scope: creatorId ? 'CREATOR' : 'GLOBAL',
      creatorId,
      word,
      action,
      active: true,
    },
  });
}

describe('크리에이터 금칙어', () => {
  it('BLOCK 단어가 든 문자는 후원으로 접수되지 않고 결제도 일어나지 않는다', async () => {
    await addWord('검수차단어', 'BLOCK', fx.creatorId);

    const res = await inbound(moPayload({ to: fx.moNumber, text: '검수차단어 포함된 응원' }));
    expect(res.result).toBe('BLOCKED');
    expect(res.status).toBe('CONTENT_BLOCKED');
    expect(await prisma.paymentTransaction.count()).toBe(0);
  });

  it('MASK 단어는 별표로 가려서 노출하고 원문은 암호화 보관한다', async () => {
    await addWord('검수마스킹어', 'MASK', fx.creatorId);

    const res = await inbound(moPayload({ to: fx.moNumber, text: '검수마스킹어 오늘 방송 좋아요' }));
    expect(res.status).not.toBe('CONTENT_BLOCKED');

    const d = await prisma.donation.findUniqueOrThrow({ where: { id: res.donationId! } });
    expect(d.message).not.toContain('검수마스킹어');
    expect(d.message).toContain('******');
    expect(d.message).toContain('오늘 방송 좋아요');
    // 분쟁 대응용 원문은 암호화해 보관한다
    expect(d.messageRawEnc).toBeTruthy();
  });

  it('FLAG 단어는 노출은 그대로 두고 기록만 남긴다', async () => {
    await addWord('검수표시어', 'FLAG', fx.creatorId);

    const res = await inbound(moPayload({ to: fx.moNumber, text: '검수표시어 화이팅' }));
    const d = await prisma.donation.findUniqueOrThrow({ where: { id: res.donationId! } });
    expect(d.message).toContain('검수표시어');
  });

  it('사용 중지(active=false)한 단어는 적용되지 않는다', async () => {
    const w = await addWord('검수차단어', 'BLOCK', fx.creatorId);
    await prisma.bannedWord.update({ where: { id: w.id }, data: { active: false } });

    const res = await inbound(moPayload({ to: fx.moNumber, text: '검수차단어 다시 보냅니다' }));
    expect(res.status).not.toBe('CONTENT_BLOCKED');
  });

  it('내 금칙어는 다른 크리에이터에게 적용되지 않는다 (스코프 격리)', async () => {
    await addWord('내단어만', 'BLOCK', fx.creatorId);

    const otherUser = await prisma.user.create({
      data: { id: newId(), email: `other-${newId()}@test.kr`, name: '다른크리에이터', role: 'CREATOR' },
    });
    const other = await prisma.creatorProfile.create({
      data: { id: newId(), userId: otherUser.id, displayName: '다른채널', code: `TOR-${newId().slice(-4)}`, status: 'APPROVED' },
    });

    const mine = await loadBannedWords(fx.creatorId);
    const theirs = await loadBannedWords(other.id);
    expect(mine.some((r) => r.word === '내단어만')).toBe(true);
    expect(theirs.some((r) => r.word === '내단어만')).toBe(false);
  });

  it('전역 금칙어와 내 금칙어가 함께 적용된다', async () => {
    await addWord('전역차단어', 'BLOCK', null);
    await addWord('내차단어', 'BLOCK', fx.creatorId);

    const rules = await loadBannedWords(fx.creatorId);
    expect(rules.some((r) => r.word === '전역차단어')).toBe(true);
    expect(rules.some((r) => r.word === '내차단어')).toBe(true);
  });

  it('대소문자·부분일치로도 잡히고, 정규식 특수문자는 문자 그대로 처리한다', () => {
    const r1 = filterContent('This is BadWord inside', { bannedWords: [{ word: 'badword', action: 'BLOCK' }] });
    expect(r1.action).toBe('BLOCK');

    // 특수문자가 정규식으로 해석되면 엉뚱한 문자가 걸린다
    const r2 = filterContent('안전한 문장입니다', { bannedWords: [{ word: 'a.c', action: 'BLOCK' }] });
    expect(r2.action).toBe('ALLOW');
  });

  it('개인정보와 링크는 금칙어와 무관하게 항상 마스킹된다', () => {
    const r = filterContent('연락처 010-1234-5678 메일 a@b.com https://spam.kr 확인', { maxLength: 200 });
    expect(r.clean).not.toContain('1234-5678');
    expect(r.clean).not.toContain('a@b.com');
    expect(r.clean).toContain('[링크 차단]');
    expect(r.containsPersonalInfo).toBe(true);
  });
});

describe('후원자 차단', () => {
  it('차단한 후원자의 문자는 접수되지 않는다', async () => {
    const donor = await prisma.donorProfile.findFirstOrThrow();
    await prisma.blockedDonor.create({
      data: { id: newId(), creatorId: fx.creatorId, donorId: donor.id, reason: '검수' },
    });

    const res = await inbound(moPayload({ to: fx.moNumber, text: '차단된 후원자 메시지' }));
    expect(res.status).toBe('LIMIT_BLOCKED');
    expect(await prisma.paymentTransaction.count()).toBe(0);
  });

  it('후원자가 건 차단은 크리에이터 차단과 분리되어 있다', async () => {
    const donor = await prisma.donorProfile.findFirstOrThrow();
    // 후원자 -> 크리에이터 방향 차단 (내 정보 > 차단 관리)
    await prisma.donorCreatorLink.create({
      data: { id: newId(), donorId: donor.id, creatorId: fx.creatorId, donorBlockedAt: new Date() },
    });

    const res = await inbound(moPayload({ to: fx.moNumber, text: '후원자가 차단한 크리에이터' }));
    expect(res.status).toBe('LIMIT_BLOCKED');
    expect(await prisma.paymentTransaction.count()).toBe(0);

    // 크리에이터가 차단했다가 해제해도(blocked_donor 행 생성 후 삭제)
    // 후원자가 건 차단은 그대로 남아야 한다. 예전에는 한 컬럼을 공유해 함께 풀렸다.
    await prisma.blockedDonor.create({
      data: { id: newId(), creatorId: fx.creatorId, donorId: donor.id, reason: '검수' },
    });
    await prisma.blockedDonor.deleteMany({ where: { creatorId: fx.creatorId, donorId: donor.id } });

    const link = await prisma.donorCreatorLink.findUniqueOrThrow({
      where: { donorId_creatorId: { donorId: donor.id, creatorId: fx.creatorId } },
    });
    expect(link.donorBlockedAt).not.toBeNull();

    const after = await inbound(moPayload({ to: fx.moNumber, text: '해제 후에도 차단 유지' }));
    expect(after.status).toBe('LIMIT_BLOCKED');
    expect(await prisma.paymentTransaction.count()).toBe(0);
  });
});
