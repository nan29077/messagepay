import { chromium } from 'playwright';
const BASE='http://localhost:3025';
const results=[]; const ok=(n,p,d='')=>{results.push({n,p,d});console.log(`${p?'PASS':'FAIL'} | ${n}${d?' | '+d:''}`);};
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// ── 1. PC 후원샵: 웹 후원 (등록 후원자) ─────────────────────────────
const pc = await (await browser.newContext({ viewport:{width:1400,height:1000} })).newPage();
await pc.goto(`${BASE}/c/TOR-8K2M`);
const pcBody = await pc.locator('body').innerText();
ok('PC: 문자후원하기 버튼', (await pc.locator('div.hidden.sm\\:block button:has-text("문자후원하기")').count())>0);
ok('PC: 코드칩·문자후원 배지 제거', !(await pc.locator('header').first().innerText()).includes('TOR-8K2M'));
ok('PC: 기본 배너 적용', (await pc.locator('header img[src*="/banners/donaido-banner-"]').count())>0);
void pcBody;

// 버튼 클릭 → 바로 금액·메시지 단계
await pc.locator('div.hidden.sm\\:block button:has-text("문자후원하기")').click();
await pc.waitForTimeout(500);
ok('PC: 클릭 시 금액·메시지 단계', (await pc.locator('body').innerText()).includes('후원 금액'));
await pc.locator('button:has-text("5,000원")').first().click();
await pc.fill('textarea','PC 웹 후원 테스트입니다! 화이팅!');
await pc.click('button:has-text("후원 진행")');
await pc.waitForTimeout(500);
ok('PC: 본인 인증 단계 진입', (await pc.locator('input[name=phone]').count())>0);

// 전화번호 인증 (등록 후원자 010-1234-5678)
await pc.fill('input[name=phone]','01012345678');
await pc.click('button:has-text("인증번호 받기")');
await pc.waitForTimeout(2000);
const devCodeText = await pc.locator('text=/테스트\\(mock\\) 환경 인증번호/').innerText().catch(()=>null);
const code = devCodeText?.match(/(\d{6})/)?.[1];
ok('PC: 인증번호 발송(mock 코드 노출)', Boolean(code));
await pc.fill('input[name=code]', code ?? '');
await pc.click('button:has-text("인증 확인")');
await pc.waitForTimeout(2500);
ok('PC: 결제 확인 단계', (await pc.locator('button:has-text("결제하고 후원하기")').count())>0);
await pc.click('button:has-text("결제하고 후원하기")');
await pc.waitForTimeout(6000);
const doneBody = await pc.locator('body').innerText();
ok('PC: 웹 후원 결제 완료', doneBody.includes('후원이 완료되었습니다'), doneBody.match(/거래번호 [A-Z0-9-]+/)?.[0] ?? '');
await pc.reload();
await pc.waitForTimeout(800);
ok('PC: 최근 후원에 웹 후원 표시', (await pc.locator('body').innerText()).includes('PC 웹 후원 테스트입니다'));

// ── 2. PC 미가입자: 가입 팝업 단계 ─────────────────────────────────
const pc2 = await (await browser.newContext({ viewport:{width:1400,height:1000} })).newPage();
await pc2.goto(`${BASE}/c/TOR-8K2M`);
await pc2.locator('div.hidden.sm\\:block button:has-text("문자후원하기")').click();
await pc2.locator('button:has-text("3,000원")').first().click();
await pc2.fill('textarea','미가입 테스트');
await pc2.click('button:has-text("후원 진행")');
await pc2.fill('input[name=phone]','01099998888');
await pc2.click('button:has-text("인증번호 받기")');
await pc2.waitForTimeout(2000);
const dc2 = (await pc2.locator('body').innerText()).match(/인증번호: (\d{6})/)?.[1] ?? (await pc2.locator('body').innerText()).match(/(\d{6})/)?.[1];
await pc2.fill('input[name=code]', dc2 ?? '');
await pc2.click('button:has-text("인증 확인")');
await pc2.waitForTimeout(2500);
const regBody = await pc2.locator('body').innerText();
ok('PC: 미가입자 → 가입 단계', regBody.includes('내통장결제 가입이 필요합니다') && regBody.includes('가입 창 열기'));
await pc2.close();

// ── 3. 모바일 후원샵: 문자후원하기 직행 (0505 번호) ─────────────
const mob = await (await browser.newContext({ viewport:{width:390,height:844} })).newPage();
await mob.goto(`${BASE}/c/TOR-8K2M`);
const mBody = await mob.locator('body').innerText();
ok('모바일: 0505 후원 번호', mBody.includes('05051001001'));
const cardHref = await mob.locator('div.sm\\:hidden a:has-text("문자후원하기")').first().getAttribute('href');
ok('모바일: 카드 CTA 문자앱 직행', Boolean(cardHref && cardHref.startsWith('sms:05051001001')), cardHref ?? '');
const barHref = await mob.locator('div.fixed a:has-text("문자후원하기")').first().getAttribute('href');
ok('모바일: 하단바 CTA 문자앱 직행', Boolean(barHref && barHref.startsWith('sms:05051001001')));
ok('모바일: 문자 보내기 문구 제거', !mBody.includes('문자후원 보내기'));
await mob.close();

// ── 4. 스튜디오: 방송·오버레이 통합 + 감사 애니메이션 ──────────────
const cr = await (await browser.newContext({ viewport:{width:1500,height:950} })).newPage();
cr.on('dialog',(d)=>d.accept());
await cr.goto(`${BASE}/login`);
await cr.fill('input[name=email]','creator1@tornado.kr');
await cr.fill('input[name=password]','tornado1234!');
await Promise.all([cr.waitForURL(/studio/),cr.click('button[type=submit]')]);

const navText = await cr.locator('aside').first().innerText();
ok('내비: 방송·오버레이 통합', navText.includes('방송·오버레이') && !navText.includes('자체 방송'));
await cr.goto(`${BASE}/studio/overlay`);
const ovBody = await cr.locator('body').innerText();
ok('오버레이: 자체 방송 섹션 통합', ovBody.includes('자체 방송 (RTMPS 송출)') && ovBody.includes('스트림 키'));
await cr.goto(`${BASE}/studio/stream`);
await cr.waitForTimeout(800);
ok('오버레이: /studio/stream 리다이렉트', cr.url().includes('/studio/overlay'));

// 오버레이 URL 발급 → 오버레이 화면에서 테스트 후원 + 감사 파티클
await cr.goto(`${BASE}/studio/overlay`);
await cr.click('button:has-text("URL 발급"), button:has-text("URL 재발급")');
await cr.waitForTimeout(2500);
let secretUrl = null;
for (const inp of await cr.locator('input[readonly]').all()) {
  const v = await inp.inputValue();
  if (/\?token=[A-Za-z0-9_-]{10,}$/.test(v)) { secretUrl = v; break; }
}
ok('오버레이: URL 발급', Boolean(secretUrl));
if (secretUrl) {
  const ov = await (await browser.newContext()).newPage();
  await ov.goto(secretUrl);
  await ov.waitForTimeout(1200);
  await cr.fill('input[name=donorName]','감사테스트');
  await cr.fill('input[name=amount]','5000');
  await cr.click('button:has-text("테스트 후원 보내기")');
  let shown=false, burst=false;
  for (let i=0;i<12 && !shown;i++){
    await ov.waitForTimeout(700);
    shown = (await ov.locator('body').innerText()).includes('감사테스트');
    if (shown) burst = (await ov.locator('.animate-thanks-float').count())>0;
  }
  ok('오버레이: 후원 알림 표시', shown);
  ok('오버레이: 감사 파티클 애니메이션', burst);
  if (shown) await ov.screenshot({ path: '/tmp/overlay-thanks.png' });
  await ov.close();
}

// ── 5. 후원 설정: 후원샵 관리 ──────────────────────────────────────
await cr.goto(`${BASE}/studio/settings`);
const setBody = await cr.locator('body').innerText();
ok('후원샵 관리: 섹션 존재', setBody.includes('후원샵 관리'));
ok('후원샵 관리: 기본 배너 5종', (await cr.locator('input[name=bannerPreset]').count()) >= 6);
ok('후원샵 관리: 소개·라이브·스위치', (await cr.locator('textarea[name=description]').count())>0 && (await cr.locator('input[name=liveUrl]').count())>0 && (await cr.locator('input[name=liveOn]').count())>0);
// 배너 2 선택 + 라이브 온
await cr.locator('input[name=bannerPreset][value="/banners/donaido-banner-02.png"]').check({ force: true });
await cr.fill('input[name=liveUrl]','https://www.youtube.com/watch?v=round6');
await cr.locator('input[name=liveOn]').check({ force: true });
await cr.click('button:has-text("후원샵 설정 저장")');
await cr.waitForTimeout(2500);
ok('후원샵 관리: 저장(온에어)', (await cr.locator('body').innerText()).includes('온에어 표시가 켜졌습니다'));

const check = await (await browser.newContext({ viewport:{width:1400,height:900} })).newPage();
await check.goto(`${BASE}/c/TOR-8K2M`);
ok('/c: 선택 배너 반영', (await check.locator('header img[src*="donaido-banner-02"]').count())>0);
ok('/c: 온에어 + 두근두근', (await check.locator('a:has-text("ON AIR")').count())>0 && (await check.locator('header .animate-heartbeat').count())>0);
await check.screenshot({ path: '/tmp/c-pc-webdonate.png' });
await check.close();

// 라이브 끄기 (원상복구)
await cr.goto(`${BASE}/studio/settings`);
await cr.locator('input[name=liveOn]').uncheck({ force: true });
await cr.click('button:has-text("후원샵 설정 저장")');
await cr.waitForTimeout(2000);

const fails=results.filter(r=>!r.p);
console.log(`\n총 ${results.length}건 중 ${results.length-fails.length} PASS / ${fails.length} FAIL`);
if(fails.length) fails.forEach(f=>console.log('  FAIL:',f.n,f.d));
await browser.close();
process.exit(fails.length?1:0);
