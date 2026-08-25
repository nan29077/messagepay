/**
 * 6차 E2E — 후원샵(/c/[code]) 화면 분기 + PC 웹 후원 PIN 인증 전 구간.
 *
 * PC 는 화면에서 바로 후원(금액·메시지 → 번호 → PIN 링크 문자 → PIN 입력 → 완료),
 * 모바일은 전용 후원 번호로 문자를 보내는 흐름이다. 두 갈래가 각각 살아있는지 본다.
 */
import {
  launch, createReporter, bodyText, missingOf, findPinLink, gotoReady,
  BASE, SEED, desktop, mobile, assertServerUp,
} from './_helpers.mjs';

await assertServerUp();
const r = createReporter('6차 — 후원샵 · PC PIN 후원 전 구간');
const b = await launch();
const SHOP = `${BASE}/c/${SEED.creator1Code}`;

try {
  // ══════════════════════════════ PC ══════════════════════════════
  const ctx = await b.newContext(desktop);
  const pc = await ctx.newPage();
  await gotoReady(pc, SHOP);
  const pcText = await bodyText(pc);

  r.ok('PC: 크리에이터 이름이 보인다', pcText.includes(SEED.creator1Name));
  r.ok('PC: 후원 패널 제목', pcText.includes(`${SEED.creator1Name} 님에게 후원하기`));
  r.ok(
    'PC: 기본 배너가 적용된다',
    (await pc.locator('header img[src*="/banners/donaido-live-banner-"]').count()) > 0,
  );
  r.ok('PC: 모의 결제 안내가 보인다', pcText.includes('현재 모의(mock) 결제 상태입니다'));
  r.ok('PC: 최근 후원 섹션', pcText.includes('최근 후원'));
  r.ok('PC: 이용 한도 안내', pcText.includes('이용 한도 안내'));
  r.ok('PC: 신고·문의 링크', (await pc.locator('a[href="/support"]').count()) > 0);

  // PC 전용 "후원 방법" 4단계 (모바일과 문구가 다르다)
  {
    const miss = missingOf(pcText, [
      '금액과 응원 메시지를 고릅니다',
      '휴대전화 번호를 입력합니다',
      'PIN 을 입력하면 결제됩니다',
      '유튜브와 방송에 표시됩니다',
    ]);
    r.ok('PC: 후원 방법 4단계(웹 기준)', miss.length === 0, miss.join(','));
  }
  r.ok('PC: 문자 기준 안내는 노출되지 않는다', !pcText.includes('첫 문자를 보내면 오는 안내'));
  r.ok('PC: 모바일 전용 번호 카드가 없다', !pcText.includes('전용 후원 번호'));

  // ── 1단계: 금액·메시지
  const startBtn = pc.locator('div.hidden.sm\\:block button:has-text("문자후원하기")');
  r.ok('PC: 후원 시작 버튼이 1개만 보인다', (await startBtn.count()) === 1);
  await startBtn.click();
  await pc.waitForSelector('text=1. 금액·메시지', { timeout: 20_000 }).catch(() => {});
  await pc.waitForTimeout(300);
  const composeText = await bodyText(pc);
  {
    const miss = missingOf(composeText, ['1. 금액·메시지', '2. 번호 입력', '3. PIN 입력', '4. 후원 완료']);
    r.ok('PC: 4단계 진행 표시가 나온다', miss.length === 0, miss.join(','));
  }
  r.ok('PC: 후원 금액 단계', composeText.includes('후원 금액'));
  r.ok('PC: 후원 메시지 단계', composeText.includes('후원 메시지'));
  r.ok('PC: 직접입력 칩', (await pc.locator('button:has-text("직접입력")').count()) > 0);
  r.ok('PC: 메시지 입력창(200자)', (await pc.locator('textarea[maxlength="200"]').count()) > 0);

  await pc.locator('textarea[maxlength="200"]').fill('E2E 자동 검증 후원입니다');
  await pc.waitForTimeout(200);
  const cta = pc.locator('button:has-text("후원 진행 (번호 입력)")');
  r.ok('PC: 금액·메시지를 채우면 다음 버튼이 활성화된다', (await cta.count()) > 0 && (await cta.isEnabled()));

  // ── 2단계: 번호 입력
  await cta.click();
  await pc.waitForSelector('input[name=phone]', { timeout: 20_000 }).catch(() => {});
  await pc.waitForTimeout(300);
  const phoneInput = pc.locator('input[name=phone]');
  r.ok('PC: 휴대전화 번호 입력칸', (await phoneInput.count()) > 0);
  r.ok(
    'PC: 이 단계에서는 출금되지 않는다는 안내',
    (await bodyText(pc)).includes('이 단계에서는 출금되지 않습니다'),
  );
  r.ok('PC: 이전 단계로 돌아가는 버튼', (await pc.locator('button:has-text("금액·메시지 다시 고르기")').count()) > 0);

  await phoneInput.fill(SEED.donorPhone);
  await pc.locator('button:has-text("PIN 입력 링크 문자로 받기")').click();

  // ── 3단계: PIN 링크 발송 대기
  await pc.waitForTimeout(2500);
  const waitText = await bodyText(pc);
  r.ok('PC: PIN 링크 발송 안내가 뜬다', waitText.includes('PIN 번호 입력 링크를 문자로 발송했습니다'), waitText.slice(0, 160));
  r.ok('PC: 남은 유효시간이 표시된다', /남은 유효시간 \d{2}:\d{2}/.test(waitText));
  r.ok('PC: 등록된 번호라 계좌 등록 단계로 빠지지 않는다', !waitText.includes('결제수단 등록이 필요합니다'));

  // ── 문자로 받은 PIN 링크를 관리자 모의 발송함에서 찾는다
  const pinUrl = await findPinLink(b);
  r.ok('문자로 PIN 입력 링크가 발송됐다', Boolean(pinUrl), pinUrl ?? '모의 발송함에서 링크를 찾지 못함');

  if (pinUrl) {
    const pinPage = await ctx.newPage();
    await gotoReady(pinPage, pinUrl);
    const pinText = await bodyText(pinPage);
    r.ok('PIN 화면: 결제 PIN 인증 제목', pinText.includes('결제 PIN 인증'));
    r.ok('PIN 화면: 모의 화면 고지', pinText.includes('[MOCK] 실제 결제사 화면이 아닙니다'));
    r.ok('PIN 화면: 입력 시 출금된다는 고지', pinText.includes('PIN 입력 시 출금됩니다'));
    r.ok('PIN 화면: 크리에이터·메시지 확인', pinText.includes(SEED.creator1Name) && pinText.includes('E2E 자동 검증 후원입니다'));

    const pinInput = pinPage.locator('input[placeholder="000000"]');
    r.ok('PIN 화면: 6자리 입력칸', (await pinInput.count()) > 0);
    const submit = pinPage.locator('button:has-text("PIN 입력하고 후원하기")');
    r.ok('PIN 미입력 상태에서는 제출이 막힌다', await submit.isDisabled());

    await pinInput.fill('123456');
    await pinPage.waitForTimeout(200);
    r.ok('6자리를 넣으면 제출이 열린다', await submit.isEnabled());
    await submit.click();
    await pinPage.waitForTimeout(3000);
    const doneText = await bodyText(pinPage);
    r.ok('PIN 화면: 후원 완료로 바뀐다', doneText.includes('후원이 완료되었습니다'), doneText.slice(0, 160));
    r.ok('PIN 화면: 거래번호가 표시된다', doneText.includes('거래번호'));

    // 같은 링크 재사용 차단
    await gotoReady(pinPage, pinUrl);
    r.ok('PIN 링크는 1회용이다', (await bodyText(pinPage)).includes('이미 처리된 인증입니다'));
    await pinPage.close();

    // ── 4단계: 후원샵 화면이 폴링으로 완료를 감지한다
    await pc.waitForTimeout(6000);
    const finalText = await bodyText(pc);
    r.ok('PC: 후원샵이 완료 상태로 전환된다', finalText.includes('후원이 완료되었습니다'), finalText.slice(0, 160));
    r.ok('PC: 거래번호가 표시된다', finalText.includes('거래번호'));
    r.ok('PC: 한 번 더 후원하기 버튼', (await pc.locator('button:has-text("한 번 더 후원하기")').count()) > 0);

    // 결제 완료 건이 최근 후원 목록에 올라온다
    const fresh = await ctx.newPage();
    await gotoReady(fresh, SHOP);
    r.ok('결제 완료 후원이 최근 후원에 노출된다', (await bodyText(fresh)).includes('E2E 자동 검증 후원입니다'));
    await fresh.close();
  }

  await ctx.close();

  // ══════════════════════════════ 모바일 ══════════════════════════════
  const mctx = await b.newContext(mobile);
  const m = await mctx.newPage();
  await gotoReady(m, SHOP);
  const mText = await bodyText(m);

  r.ok('모바일: 전용 후원 번호 카드', mText.includes(`${SEED.creator1Name} 전용 후원 번호`));
  r.ok('모바일: 배정된 MO 번호가 보인다', mText.includes(SEED.creator1Mo));
  r.ok('모바일: 번호 복사 버튼', (await m.locator('button:has-text("번호 복사")').count()) > 0);
  r.ok('모바일: sms 링크로 문자 앱을 연다', (await m.locator(`a[href^="sms:"]`).count()) > 0);
  r.ok('모바일: 하단 고정 후원 바', (await m.locator('div.fixed.inset-x-0.bottom-0').count()) > 0);
  r.ok('모바일: 첫 문자 안내', mText.includes('처음 보내는 문자는 후원되지 않습니다'));
  {
    const miss = missingOf(mText, [
      '계좌를 1회 등록합니다',
      '응원 문자를 보냅니다',
      'PIN 을 입력하면 결제됩니다',
      '방송에 표시됩니다',
    ]);
    r.ok('모바일: 후원 방법 4단계(문자 기준)', miss.length === 0, miss.join(','));
  }
  r.ok('모바일: PC 후원 패널은 숨는다', !mText.includes(`${SEED.creator1Name} 님에게 후원하기`));
  await mctx.close();

  // ══════════════════════════════ 잘못된 코드 ══════════════════════════════
  const nctx = await b.newContext(desktop);
  const n = await nctx.newPage();
  await gotoReady(n, `${BASE}/c/TOR-XXXX`);
  r.ok('없는 코드는 안내 화면을 보여준다', (await bodyText(n)).includes('크리에이터를 찾을 수 없습니다'));
  await nctx.close();
} catch (e) {
  r.ok('스크립트가 끝까지 실행된다', false, String(e?.message ?? e).slice(0, 200));
} finally {
  await b.close();
}

r.finish();
