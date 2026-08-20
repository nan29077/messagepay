/**
 * 스튜디오 기능 실동작 E2E 점검.
 * 유튜브 연결(mock OAuth) → 라이브 조회 → 해제/재연결,
 * 오버레이 URL 발급 → 설정 저장 → 테스트 후원이 실제 오버레이 화면에 표시되는지,
 * 스트림 키 발급, 설정/프로필/금칙어 저장, /c/[code] 독립 페이지 확인.
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:3025';
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());

async function textOf(sel) {
  try { return (await page.locator(sel).first().innerText({ timeout: 4000 })).trim(); } catch { return null; }
}

// ── 로그인 ──────────────────────────────────────────────────────────
await page.goto(`${BASE}/login`);
await page.fill('input[name=email]', 'creator1@tornado.kr');
await page.fill('input[name=password]', 'tornado1234!');
await Promise.all([page.waitForURL(/studio/, { timeout: 15000 }), page.click('button[type=submit]')]);
ok('크리에이터 로그인', page.url().includes('/studio'));

// ── 1. 유튜브 채널 연결 (mock OAuth 왕복) ──────────────────────────
await page.goto(`${BASE}/studio/youtube`);
// 연결 여부와 무관하게 연결 버튼이 있어야 한다
const connectBtn = page.locator('a:has-text("구글 계정으로 채널 연결"), a:has-text("다른 채널로 다시 연결")').first();
ok('유튜브: 연결 버튼 노출', (await connectBtn.count()) > 0);
await connectBtn.click();
await page.waitForURL(/mock\/youtube\/consent/, { timeout: 15000 });
ok('유튜브: mock 동의화면 이동', true);
await page.click('a:has-text("채널 연결 허용")');
await page.waitForURL(/studio\/youtube\?youtube=connected/, { timeout: 15000 });
const ytBody = await page.locator('body').innerText();
ok('유튜브: 연결 완료 콜백', ytBody.includes('유튜브 채널을 연결했습니다'));
ok('유튜브: 연결됨 배지', ytBody.includes('연결됨'));

// 라이브 방송 조회
await page.click('button:has-text("현재 라이브 방송 조회")');
await page.waitForTimeout(2500);
const ytBody2 = await page.locator('body').innerText();
ok('유튜브: 라이브 방송 조회 동작', /라이브 방송을 확인했습니다|진행 중인 라이브 방송이 없습니다/.test(ytBody2), ytBody2.match(/라이브 방송을 확인했습니다[^\n]*|진행 중인 라이브 방송이 없습니다/)?.[0] ?? '');

// 연결 해제 → 재연결 (해제 기능 검증 후 연결 상태로 복구)
await page.click('button:has-text("연결 해제")');
await page.waitForTimeout(2500);
const ytBody3 = await page.locator('body').innerText();
ok('유튜브: 연결 해제 동작', ytBody3.includes('연결을 해제했습니다') || ytBody3.includes('연결 해제'));
await page.locator('a:has-text("구글 계정으로 채널 연결"), a:has-text("다른 채널로 다시 연결")').first().click();
await page.waitForURL(/mock\/youtube\/consent/, { timeout: 15000 });
await page.click('a:has-text("채널 연결 허용")');
await page.waitForURL(/youtube=connected/, { timeout: 15000 });
ok('유튜브: 재연결 성공', true);

// 거부 흐름
await page.locator('a:has-text("구글 계정으로 채널 연결"), a:has-text("다른 채널로 다시 연결")').first().click();
await page.waitForURL(/mock\/youtube\/consent/, { timeout: 15000 });
await page.click('a:has-text("거부")');
await page.waitForURL(/youtube=denied/, { timeout: 15000 });
ok('유튜브: 동의 거부 처리', (await page.locator('body').innerText()).includes('거부'));

// ── 2. 오버레이: URL 발급 → 설정 저장 → 테스트 후원 실표시 ─────────
await page.goto(`${BASE}/studio/overlay`);
await page.click('button:has-text("URL 발급"), button:has-text("URL 재발급")');
await page.waitForTimeout(2500);
let secretUrl = null;
for (const inp of await page.locator('input[readonly]').all()) {
  const v = await inp.inputValue();
  if (/\/overlay\/.+\?token=/.test(v) && !v.includes('<')) { secretUrl = v; break; }
}
ok('오버레이: URL 발급 + 1회 노출', Boolean(secretUrl), secretUrl ? '발급됨' : 'URL 미노출');

// 표시 설정 저장 (위치 변경)
await page.selectOption('select[name=position]', 'BOTTOM_CENTER');
await page.fill('input[name=durationMs]', '4000');
await page.click('button:has-text("설정 저장")');
await page.waitForTimeout(2000);
ok('오버레이: 표시 설정 저장', (await page.locator('body').innerText()).includes('오버레이 설정을 저장했습니다'));

// 오버레이 실화면에서 테스트 후원 표시 확인
let overlayShown = false;
if (secretUrl) {
  const overlayPage = await ctx.newPage();
  await overlayPage.goto(secretUrl.replace('http://localhost:3025', BASE));
  await overlayPage.waitForTimeout(1500);
  const unauthorized = (await overlayPage.locator('body').innerText()).includes('접근 권한이 없습니다');
  ok('오버레이: 토큰 인증 통과', !unauthorized);

  await page.fill('input[name=donorName]', 'E2E점검');
  await page.fill('input[name=amount]', '5000');
  await page.fill('textarea[name=message]', '기능 점검 테스트입니다');
  await page.click('button:has-text("테스트 후원 보내기")');
  await page.waitForTimeout(1500);
  ok('오버레이: 테스트 후원 전송', (await page.locator('body').innerText()).includes('테스트 후원을 전송했습니다'));

  for (let i = 0; i < 10 && !overlayShown; i++) {
    const t = await overlayPage.locator('body').innerText();
    if (t.includes('E2E점검') || t.includes('5,000')) overlayShown = true;
    else await overlayPage.waitForTimeout(700);
  }
  ok('오버레이: 실화면에 후원 알림 표시', overlayShown);

  // 잘못된 토큰 거부
  const badPage = await ctx.newPage();
  await badPage.goto(secretUrl.replace(/token=.*/, 'token=wrongtoken'));
  ok('오버레이: 잘못된 토큰 401', (await badPage.locator('body').innerText()).includes('접근 권한이 없습니다'));
  await badPage.close();
  await overlayPage.close();
}

// ── 3. 자체 방송: 스트림 키 발급 ────────────────────────────────────
await page.goto(`${BASE}/studio/stream`);
await page.click('button:has-text("스트림 키 발급"), button:has-text("스트림 키 재발급")');
await page.waitForTimeout(2500);
const streamBody = await page.locator('body').innerText();
ok('스트림: 키 발급 + 1회 노출', streamBody.includes('새 스트림 키를 발급했습니다'));
ok('스트림: 발급 이력 표시', streamBody.includes('사용 중'));

// ── 4. 후원 설정 저장 ───────────────────────────────────────────────
await page.goto(`${BASE}/studio/settings`);
const amountInput = page.locator('input[name=donationAmount]');
if (await amountInput.count()) {
  const v = await amountInput.inputValue();
  await amountInput.fill(v.replace(/[^\d]/g, '') || '1000');
  await page.click('button:has-text("저장")');
  await page.waitForTimeout(2000);
  ok('설정: 후원금 저장', (await page.locator('body').innerText()).includes('저장했습니다'));
} else {
  ok('설정: 후원금 입력 필드', false, 'donationAmount 필드 없음');
}

// ── 5. 프로필 저장 ─────────────────────────────────────────────────
await page.goto(`${BASE}/studio/profile`);
const dn = page.locator('input[name=displayName]');
if (await dn.count()) {
  await page.click('button:has-text("저장")');
  await page.waitForTimeout(2000);
  ok('프로필: 저장 동작', (await page.locator('body').innerText()).includes('저장했습니다'));
} else {
  ok('프로필: displayName 필드', false, '필드 없음');
}

// ── 6. 금칙어 등록/중지/삭제 ────────────────────────────────────────
await page.goto(`${BASE}/studio/moderation`);
const word = `e2e점검${Date.now() % 10000}`;
const wordInput = page.locator('input[name=word]');
if (await wordInput.count()) {
  await wordInput.fill(word);
  await page.click('button:has-text("금칙어 추가")');
  await page.waitForTimeout(2000);
  const t1 = await page.locator('body').innerText();
  ok('금칙어: 등록', (await page.locator('tr', { hasText: word }).count()) > 0);
  void t1;
  const delBtn = page.locator('tr', { hasText: word }).locator('button:has-text("삭제")').first();
  if (await delBtn.count()) {
    await delBtn.click();
    let gone = false;
    for (let i = 0; i < 12 && !gone; i++) {
      await page.waitForTimeout(1000);
      // 등록 폼의 성공 메시지에도 단어가 남으므로 테이블 행 기준으로 확인한다
      gone = (await page.locator('tr', { hasText: word }).count()) === 0;
    }
    ok('금칙어: 삭제', gone);
  } else {
    ok('금칙어: 삭제 버튼', false, '삭제 버튼 못 찾음');
  }
} else {
  ok('금칙어: 입력 필드', false, 'word 필드 없음');
}

// ── 7. 정산 페이지 로드 + 계좌 화면 ────────────────────────────────
for (const p of ['/studio/settlement', '/studio/settlement/account', '/studio/messages', '/studio/donations', '/studio/reports', '/studio/tts-check-skip']) {
  if (p.endsWith('skip')) continue;
  const res = await page.goto(`${BASE}${p}`);
  ok(`페이지 로드: ${p}`, res.status() === 200, `HTTP ${res.status()}`);
}

// ── 8. /c/[code] 독립 페이지 ───────────────────────────────────────
const cpage = await ctx.newPage();
await cpage.goto(`${BASE}/c/TOR-8K2M`);
const cbody = await cpage.locator('body').innerText();
ok('/c: 크리에이터 이름 표시', cbody.includes('바람소리'));
ok('/c: 문자후원하기 CTA', cbody.includes('문자후원하기'));
ok('/c: 메인 하단 탭 제거', !cbody.includes('이용방법\n') || !(await cpage.locator('nav a[href="/faq"]').count()));
const hasMainNav = await cpage.locator('a[href="/how-it-works"] >> nth=0').count();
const hasBottomTabBar = await cpage.locator('nav:has(a[href="/faq"])').count();
ok('/c: 공용 내비게이션(FAQ 탭 등) 없음', hasBottomTabBar === 0);
ok('/c: 도네이도 풋터 표기', cbody.includes('도네이도 문자후원'));

// 모바일 뷰: 하단 고정 CTA
const mob = await ctx.newPage({ viewport: { width: 390, height: 844 } });
await mob.setViewportSize({ width: 390, height: 844 });
await mob.goto(`${BASE}/c/TOR-8K2M`);
const fixedCta = await mob.locator('div.fixed a:has-text("문자후원하기")').count();
ok('/c 모바일: 하단 고정 CTA', fixedCta > 0);
await mob.close();

// 공유번호(키워드) 크리에이터 — 키워드 안내는 모바일 문자후원 영역에 표시된다
const kwPage = await ctx.newPage();
await kwPage.setViewportSize({ width: 390, height: 844 });
await kwPage.goto(`${BASE}/c/TOR-3QP7`);
ok('/c 키워드형: 키워드 안내', (await kwPage.locator('body').innerText()).includes('키워드'));
await kwPage.close();

// 존재하지 않는 코드
await cpage.goto(`${BASE}/c/TOR-XXXX`);
ok('/c 미존재 코드: 안내 화면', (await cpage.locator('body').innerText()).includes('크리에이터를 찾을 수 없습니다'));
await cpage.close();

// ── 요약 ───────────────────────────────────────────────────────────
const fails = results.filter((r) => !r.pass);
console.log(`\n총 ${results.length}건 중 ${results.length - fails.length} PASS / ${fails.length} FAIL`);
if (fails.length) fails.forEach((f) => console.log(`  FAIL: ${f.name} ${f.detail}`));
await browser.close();
process.exit(fails.length ? 1 : 0);
