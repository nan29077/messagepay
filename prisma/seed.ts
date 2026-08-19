import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { newId } from '../src/lib/id';
import { encrypt, phoneHash, maskPhone, generateToken, tokenHash, maskSecret } from '../src/lib/crypto';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('토네이도 시드 데이터 생성 시작');

  // ---------------------------------------------------------------- 시스템 설정
  const settings: Array<[string, unknown, string]> = [
    ['payment.mode', 'CONFIRM_LINK', '전역 기본 결제 모드. DIRECT_TRIGGER 는 금융사 서면승인 후에만 허용'],
    ['payment.confirmTtlSec', 300, '결제 확인 링크 유효시간(초). 헥토 10분 제한보다 짧게 유지'],
    ['donation.defaultAmount', 3000, '문자 1건당 기본 후원금'],
    ['youtube.dailyQuota', 10000, 'YouTube Data API 일일 할당량(실측 후 조정)'],
    ['service.name', '토네이도', '서비스명'],
  ];
  for (const [key, value, memo] of settings) {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: value as object, memo },
      update: { value: value as object, memo },
    });
  }

  // ---------------------------------------------------------------- 약관
  const terms: Array<{ type: 'TERMS_SERVICE' | 'PRIVACY' | 'E_FINANCE' | 'WITHDRAWAL_AGREE' | 'AGE_CONFIRM' | 'MARKETING'; title: string; content: string; required: boolean }> = [
    { type: 'TERMS_SERVICE', title: '토네이도 서비스 이용약관', content: '제1조(목적) 이 약관은 토네이도가 제공하는 문자후원 서비스의 이용조건 및 절차를 규정합니다. (샘플 문안 — 법률 검토 후 교체 필요)', required: true },
    { type: 'PRIVACY', title: '개인정보 수집 및 이용 동의', content: '수집항목: 휴대전화번호, 결제 관련 정보. 이용목적: 후원 처리 및 결과 안내. 보유기간: 관계 법령에 따름. (샘플 문안)', required: true },
    { type: 'E_FINANCE', title: '전자금융거래 이용약관', content: '전자금융거래의 이용조건, 거래내용 확인, 오류 정정 절차를 규정합니다. (샘플 문안)', required: true },
    { type: 'WITHDRAWAL_AGREE', title: '출금이체 동의', content: '문자후원 발생 시 등록한 계좌에서 후원금이 출금되는 것에 동의합니다. (샘플 문안)', required: true },
    { type: 'AGE_CONFIRM', title: '만 19세 이상 확인', content: '본인은 만 19세 이상이며 미성년자가 아님을 확인합니다.', required: true },
    { type: 'MARKETING', title: '마케팅 정보 수신 동의', content: '이벤트 및 혜택 안내를 받는 것에 동의합니다. (선택)', required: false },
  ];
  for (const t of terms) {
    await prisma.termsVersion.upsert({
      where: { type_version: { type: t.type, version: '1.0' } },
      create: { id: newId(), type: t.type, version: '1.0', title: t.title, content: t.content, required: t.required, effectiveFrom: new Date('2026-01-01T00:00:00Z') },
      update: {},
    });
  }

  // ---------------------------------------------------------------- 정책
  const existingPolicy = await prisma.donationLimitPolicy.findFirst({ where: { scope: 'GLOBAL' } });
  if (!existingPolicy) {
    await prisma.donationLimitPolicy.create({ data: { id: newId(), scope: 'GLOBAL' } });
  }

  const existingFee = await prisma.feePolicy.findFirst({ where: { scope: 'GLOBAL' } });
  if (!existingFee) {
    await prisma.feePolicy.create({
      data: { id: newId(), scope: 'GLOBAL', pgFeeRate: '0.018', platformFeeRate: '0.15', smsCost: 20 },
    });
  }

  // ---------------------------------------------------------------- 금칙어
  const words: Array<[string, 'BLOCK' | 'MASK']> = [
    ['도박', 'BLOCK'], ['불법', 'BLOCK'], ['사기', 'MASK'],
    ['씨발', 'MASK'], ['개새끼', 'MASK'], ['죽여', 'BLOCK'],
  ];
  for (const [word, action] of words) {
    const exists = await prisma.bannedWord.findFirst({ where: { word, creatorId: null } });
    if (!exists) await prisma.bannedWord.create({ data: { id: newId(), word, action, scope: 'GLOBAL' } });
  }

  // ---------------------------------------------------------------- 관리자
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@tornado.kr' },
    create: {
      id: newId(), email: 'admin@tornado.kr', name: '토네이도 관리자',
      role: 'ADMIN', passwordHash: await bcrypt.hash('tornado1234!', 10),
    },
    update: { role: 'ADMIN' },
  });
  await prisma.adminProfile.upsert({
    where: { userId: adminUser.id },
    create: { id: newId(), userId: adminUser.id, permission: 'SUPER_ADMIN' },
    update: { permission: 'SUPER_ADMIN' },
  });

  // ---------------------------------------------------------------- 크리에이터
  const creatorSeeds = [
    { email: 'creator1@tornado.kr', name: '바람소리', code: 'TOR-8K2M', mo: '15881001', mode: 'DEDICATED' as const, keyword: null },
    { email: 'creator2@tornado.kr', name: '별하늘', code: 'TOR-3QP7', mo: '15889000', mode: 'SHARED_PREFIX' as const, keyword: 'TOR3QP7' },
  ];

  for (const c of creatorSeeds) {
    const user = await prisma.user.upsert({
      where: { email: c.email },
      create: {
        id: newId(), email: c.email, name: c.name, role: 'CREATOR',
        passwordHash: await bcrypt.hash('tornado1234!', 10),
      },
      update: { role: 'CREATOR' },
    });

    const creator = await prisma.creatorProfile.upsert({
      where: { userId: user.id },
      create: {
        id: newId(), userId: user.id, code: c.code, displayName: c.name,
        channelName: `${c.name} 채널`, status: 'APPROVED', donationAmount: 3000,
        approvedAt: new Date(),
        description: '문자 한 통으로 응원을 보내주세요.',
      },
      update: { status: 'APPROVED' },
    });

    const codeExists = await prisma.creatorCode.findUnique({ where: { code: c.code } });
    if (!codeExists) {
      await prisma.creatorCode.create({ data: { id: newId(), creatorId: creator.id, code: c.code, active: true } });
    }

    const moExists = await prisma.creatorMoNumber.findFirst({ where: { phoneNumber: c.mo, keyword: c.keyword } });
    if (!moExists) {
      await prisma.creatorMoNumber.create({
        data: {
          id: newId(), phoneNumber: c.mo, keyword: c.keyword, mode: c.mode,
          status: 'ASSIGNED', creatorId: creator.id, providerId: 'mock',
          assignedAt: new Date(), monthlyCost: c.mode === 'DEDICATED' ? 30000 : 0,
        },
      });
    }

    const overlayToken = generateToken(24);
    await prisma.overlaySetting.upsert({
      where: { creatorId: creator.id },
      create: {
        id: newId(), creatorId: creator.id,
        tokenHash: tokenHash(overlayToken), tokenMasked: maskSecret(overlayToken),
      },
      update: {},
    });
    console.log(`  오버레이 URL(${c.name}): /overlay/${creator.id}?token=${overlayToken}`);

    await prisma.ttsSetting.upsert({
      where: { creatorId: creator.id },
      create: { id: newId(), creatorId: creator.id },
      update: {},
    });

    await prisma.youTubeConnection.upsert({
      where: { creatorId: creator.id },
      create: {
        id: newId(), creatorId: creator.id, channelId: `UCmock-${creator.id.slice(-8)}`,
        channelTitle: `${c.name} 채널`,
        accessTokenEnc: encrypt('mock-access-token'),
        refreshTokenEnc: encrypt('mock-refresh-token'),
        scope: 'https://www.googleapis.com/auth/youtube.force-ssl',
        expiresAt: new Date(Date.now() + 3600_000),
        status: 'CONNECTED',
      },
      update: {},
    });

    const channel = await prisma.streamChannel.upsert({
      where: { creatorId: creator.id },
      create: {
        id: newId(), creatorId: creator.id,
        ingestUrl: 'rtmps://ingest.tornado.kr/live',
        playbackUrl: `https://play.tornado.kr/hls/${creator.id}.m3u8`,
      },
      update: {},
    });
    const keyExists = await prisma.streamKey.findFirst({ where: { channelId: channel.id, status: 'ACTIVE' } });
    if (!keyExists) {
      const raw = `tor_${generateToken(18)}`;
      await prisma.streamKey.create({
        data: { id: newId(), channelId: channel.id, keyHash: tokenHash(raw), keyMasked: maskSecret(raw) },
      });
    }

    await prisma.settlementAccount.upsert({
      where: { creatorId: creator.id },
      create: {
        id: newId(), creatorId: creator.id, bankCode: '004', bankName: 'KB국민은행',
        accountEnc: encrypt('11122233344455'), accountTail4: '4455',
        holderNameEnc: encrypt(c.name), holderMasked: `${c.name[0]}*${c.name.slice(2)}`,
        verified: true, verifiedAt: new Date(),
      },
      update: {},
    });
  }

  // ---------------------------------------------------------------- 테스트 후원자 (계좌 등록 완료 상태)
  const testPhone = '01012345678';
  const donor = await prisma.donorProfile.upsert({
    where: { phoneHash: phoneHash(testPhone) },
    create: {
      id: newId(), phoneHash: phoneHash(testPhone), phoneEnc: encrypt(testPhone),
      phoneMasked: maskPhone(testPhone), displayName: '테스트후원자',
      ageVerified: true, registeredAt: new Date(),
    },
    update: {},
  });
  const tokenExists = await prisma.paymentMethodToken.findFirst({ where: { donorId: donor.id, status: 'ACTIVE' } });
  if (!tokenExists) {
    const billKey = 'MOCKBILL-SEED-4455';
    await prisma.paymentMethodToken.create({
      data: {
        id: newId(), donorId: donor.id, provider: 'mock',
        billKeyEnc: encrypt(billKey), billKeyHint: maskSecret(billKey),
        bankCode: '004', bankName: 'KB국민은행', accountTail4: '4455',
      },
    });
  }

  // ---------------------------------------------------------------- 콘텐츠
  const posts: Array<{ type: string; title: string; body: string; category?: string; sortOrder: number }> = [
    { type: 'FAQ', title: '문자후원은 어떻게 이용하나요?', body: '크리에이터의 후원 번호로 문자를 보내면 됩니다. 최초 1회 계좌 등록과 이용 동의가 필요하며, 최초 문자는 후원 처리되지 않습니다.', category: '이용방법', sortOrder: 1 },
    { type: 'FAQ', title: '최초 문자도 후원되나요?', body: '아니요. 최초 문자는 후원 처리되지 않고 계좌 등록 안내만 발송됩니다. 등록 완료 후 보내는 문자부터 후원이 접수됩니다.', category: '이용방법', sortOrder: 2 },
    { type: 'FAQ', title: '후원 한도가 있나요?', body: '기본 일일 100,000원, 1분 내 3건, 연속 5건 이후 대기시간이 적용됩니다. 한도는 마이페이지에서 더 낮게 설정할 수 있습니다.', category: '한도', sortOrder: 3 },
    { type: 'FAQ', title: '후원을 취소할 수 있나요?', body: '결제 직후 고객센터로 요청하시면 정산 전인 건에 한해 취소·환불이 가능합니다.', category: '환불', sortOrder: 4 },
    { type: 'FAQ', title: '유튜브 슈퍼챗과 같은 건가요?', body: '아닙니다. 토네이도 후원은 유튜브 공식 슈퍼챗이 아닌 외부 후원이며, 채팅에는 연결된 채널 계정으로 표시됩니다.', category: '방송', sortOrder: 5 },
    { type: 'NOTICE', title: '토네이도 베타 서비스 안내', body: '현재 토네이도는 준비 단계이며 실제 결제와 문자 발송은 비활성화되어 있습니다.', sortOrder: 1 },
  ];
  for (const p of posts) {
    const exists = await prisma.contentPost.findFirst({ where: { type: p.type, title: p.title } });
    if (!exists) {
      await prisma.contentPost.create({
        data: { id: newId(), type: p.type, title: p.title, body: p.body, category: p.category ?? null, sortOrder: p.sortOrder },
      });
    }
  }

  console.log('시드 완료');
  console.log('  관리자     : admin@tornado.kr / tornado1234!');
  console.log('  크리에이터 : creator1@tornado.kr / tornado1234! (코드 TOR-8K2M, MO 15881001)');
  console.log('  크리에이터 : creator2@tornado.kr / tornado1234! (코드 TOR-3QP7, MO 15889000 + 키워드 TOR3QP7)');
  console.log('  테스트후원자: 010-1234-5678 (계좌 등록 완료 상태)');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
