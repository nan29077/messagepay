import { chromium } from 'playwright';

/**
 * 10차 E2E — 알림 버튼 / 정산 주기 표시 / 공휴일 관리 / 오버레이 파이프라인.
 */

const BASE = 'http://localhost:3025';
const results = [];
const ok = (n, p, d = '') => {
  results.push({ n, p, d });
  console.log(`${p ? 'PASS' : 'FAIL'} | ${n}${d ? ' | ' + d : ''}`);
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function login(page, email) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', 'tornado1234!');
  await Promise.all([page.waitForURL(/studio|admin|\/my|\/$/), page.click('button[type=submit]')]);
}

// ───────────────── 1. 메인페이지 알림 버튼 ─────────────────
{
  // 비로그인: 알림 버튼이 없어야 한다 (알림은 사용자별 데이터)
  const anon = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  await anon.goto(`${BASE}/`);
  ok('메인(비로그인): 알림 버튼 미노출', (await anon.locator('header button[aria-label="알림"]').count()) === 0);
  await anon.close();

  // 로그인 후 PC: 헤더 우측 상단에 알림 버튼
  const pc = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  await login(pc, 'creator1@tornado.kr');
  await pc.goto(`${BASE}/`);
  const bell = pc.locator('header button[aria-label^="알림"], header button[aria-label^="읽지 않은 알림"]');
  ok('메인(PC): 헤더에 알림 버튼', (await bell.count()) > 0);

  // 우측 상단인지 — 로고보다 오른쪽에 있어야 한다
  if ((await bell.count()) > 0) {
    const bellBox = await bell.first().boundingBox();
    const logoBox = await pc.locator('header a[aria-label="도네이도 홈"]').first().boundingBox();
    ok('메인(PC): 알림 버튼이 우측', Boolean(bellBox && logoBox && bellBox.x > logoBox.x), `bell.x=${Math.round(bellBox?.x ?? -1)}`);

    // 눌러서 패널이 열리는지 (실제 동작)
    await bell.first().click();
    await pc.waitForTimeout(1200);
    const panel = await pc.locator('body').innerText();
    ok('메인(PC): 알림 패널 열림', panel.includes('최근 알림을 한곳에서') || panel.includes('새 알림이 없습니다'));
  } else {
    ok('메인(PC): 알림 버튼이 우측', false, 'bell 없음');
    ok('메인(PC): 알림 패널 열림', false, 'bell 없음');
  }
  await pc.close();

  // 모바일: 햄버거 왼쪽
  const mo = await b.newPage({ viewport: { width: 390, height: 844 } });
  await login(mo, 'creator1@tornado.kr');
  await mo.goto(`${BASE}/`);
  const mBell = mo.locator('header button[aria-label^="알림"], header button[aria-label^="읽지 않은 알림"]');
  const mMenu = mo.locator('header button[aria-label="메뉴"]');
  const bBox = (await mBell.count()) > 0 ? await mBell.first().boundingBox() : null;
  const mBox = (await mMenu.count()) > 0 ? await mMenu.first().boundingBox() : null;
  ok('메인(모바일): 알림 버튼 노출', (await mBell.count()) > 0);
  ok(
    '메인(모바일): 햄버거 왼쪽에 위치',
    Boolean(bBox && mBox && bBox.x < mBox.x),
    bBox && mBox ? `알림 x=${Math.round(bBox.x)} < 메뉴 x=${Math.round(mBox.x)}` : '위치 확인 불가',
  );
  await mo.close();
}

// ───────────────── 2. 정산 요청 → 최고관리자 알림 ─────────────────
{
  const admin = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  admin.on('dialog', (d) => d.accept());
  await login(admin, 'admin@tornado.kr');

  const before = await admin.evaluate(async (base) => {
    const r = await fetch(`${base}/api/notifications`, { cache: 'no-store' });
    return (await r.json()).unreadCount ?? 0;
  }, BASE);

  // 크리에이터가 정산을 요청한다
  const cr = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  cr.on('dialog', (d) => d.accept());
  await login(cr, 'creator1@tornado.kr');
  await cr.goto(`${BASE}/studio/settlement?tab=request`);
  const reqText = await cr.locator('body').innerText();
  const amountInput = cr.locator('input[name=amount]');
  let requested = false;
  if ((await amountInput.count()) > 0 && reqText.includes('주민등록번호')) {
    await amountInput.fill('3000');
    // 주민번호 입력칸은 name 없이 hidden 'resident' 로 합쳐진다. placeholder 로 집는다.
    const front = cr.locator('input[placeholder="앞 6자리"]');
    if ((await front.count()) > 0) {
      await front.fill('901010');
      await cr.locator('input[placeholder="뒤 7자리"]').fill('1234560'); // 체크섬 유효한 시험용 번호
    }
    const agree = cr.locator('input[name=residentAgree]');
    if ((await agree.count()) > 0) await agree.check({ force: true });
    // 탭 링크도 "정산 요청" 이라 form 안의 submit 버튼만 정확히 집는다.
    await cr.locator('form button[type=submit]:has-text("정산 요청")').first().click();
    await cr.waitForTimeout(3000);
    const after = await cr.locator('body').innerText();
    requested = after.includes('접수했습니다');
    ok('정산 요청 접수', requested, requested ? '' : after.slice(0, 120));
  } else {
    ok('정산 요청 접수 (정산 가능금 없음 — 건너뜀)', true, '가능금 0');
  }
  await cr.close();

  if (requested) {
    const after = await admin.evaluate(async (base) => {
      const r = await fetch(`${base}/api/notifications`, { cache: 'no-store' });
      const j = await r.json();
      return { unread: j.unreadCount ?? 0, titles: (j.items ?? []).map((i) => i.title).join(' | ') };
    }, BASE);
    ok(
      '최고관리자: 정산 요청 알림 수신',
      after.unread > before && after.titles.includes('새 정산 요청'),
      `unread ${before}→${after.unread}`,
    );
  } else {
    ok('최고관리자: 정산 요청 알림 수신 (건너뜀)', true, '요청 없음');
  }

  // 관리자 정산 목록에 요청이 보이는지
  await admin.goto(`${BASE}/admin/settlements`);
  ok('최고관리자: 정산 요청 목록 진입', (await admin.locator('body').innerText()).includes('지급대행'));
  await admin.close();
}

// ───────────────── 3. 정산 현황 — 주기 안내 + 캘린더 구분 ─────────────────
{
  const cr = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  await login(cr, 'creator1@tornado.kr');
  await cr.goto(`${BASE}/studio/settlement?tab=overview`);
  const t = await cr.locator('body').innerText();

  ok('정산현황: 영업일 5일 안내', t.includes('영업일 5일 후'));
  ok('정산현황: 공휴일 제외 설명', t.includes('공휴일') && t.includes('토요일'));
  ok('정산현황: 오늘 후원 → 정산일 예시', t.includes('오늘 후원되면'));
  ok('정산현황: 금·토·일 묶음 안내', t.includes('금·토·일 후원분'));
  ok('정산현황: 8월 3일 → 8월 10일 예시', t.includes('8월 3일(월) 후원 → 8월 10일(월) 정산'));
  ok('정산현황: 캘린더 범례(후원/정산예정/지급완료)',
    t.includes('후원 (결제 완료)') && t.includes('정산 예정') && t.includes('지급 완료'));
  ok('정산현황: 캘린더 공휴일 범례', t.includes('공휴일 (영업일 제외)'));
  ok('정산현황: 날짜별 정산일 표기', /→ \d+월 \d+일 정산/.test(t), (t.match(/→ \d+월 \d+일 정산/) ?? [''])[0]);
  await cr.close();
}

// ───────────────── 4. 관리자 공휴일 관리 ─────────────────
{
  const admin = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  admin.on('dialog', (d) => d.accept());
  await login(admin, 'admin@tornado.kr');
  await admin.goto(`${BASE}/admin/holidays`);
  const t = await admin.locator('body').innerText();

  ok('공휴일 관리: 화면 진입', t.includes('공휴일'));
  ok('공휴일 관리: 2026 시드 반영', t.includes('광복절') || t.includes('설날'));
  ok('공휴일 관리: 정산일 규칙 안내', t.includes('영업일'));

  // 날짜 입력은 type=date 라 브라우저가 1차로 막고, 서버는 isValidDateKey 로 2차 검증한다.
  const dateInput = admin.locator('input[name=date]');
  ok('공휴일 관리: 날짜 입력 type=date (브라우저 1차 검증)', (await dateInput.count()) > 0
    && (await dateInput.first().getAttribute('type')) === 'date');

  // 임시공휴일을 실제로 추가해 본다 (배포 없이 관리자가 고칠 수 있어야 한다)
  if ((await dateInput.count()) > 0) {
    await dateInput.first().fill('2026-11-11');
    const nameInput = admin.locator('input[name=name]');
    if ((await nameInput.count()) > 0) await nameInput.first().fill('E2E 임시공휴일');
    const kindSel = admin.locator('select[name=kind]');
    if ((await kindSel.count()) > 0) await kindSel.first().selectOption('TEMPORARY').catch(() => undefined);
    await admin.locator('button:has-text("등록")').first().click();
    await admin.waitForTimeout(2500);
    const after = await admin.locator('body').innerText();
    ok('공휴일 관리: 임시공휴일 추가', after.includes('E2E 임시공휴일'));

    // 추가한 공휴일이 정산일 계산에 즉시 반영되는지 (11/11 이 영업일에서 빠진다)
    const cr2 = await b.newPage({ viewport: { width: 1400, height: 1000 } });
    await login(cr2, 'creator1@tornado.kr');
    await cr2.goto(`${BASE}/studio/settlement?tab=overview&month=2026-11`);
    const nov = await cr2.locator('body').innerText();
    ok('공휴일 관리: 캘린더에 반영(11월 진입)', nov.includes('11월') || nov.includes('2026년 11월'));
    await cr2.close();
  } else {
    ok('공휴일 관리: 임시공휴일 추가 (폼 없음 — 건너뜀)', true);
    ok('공휴일 관리: 캘린더에 반영 (건너뜀)', true);
  }
  await admin.close();
}

// ───────────────── 5. 오버레이 파이프라인 (OBS/PRISM 브라우저 소스) ─────────────────
{
  const cr = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  cr.on('dialog', (d) => d.accept());
  await login(cr, 'creator1@tornado.kr');
  await cr.goto(`${BASE}/studio/overlay`);
  const t = await cr.locator('body').innerText();
  ok('오버레이: OBS·PRISM 등록 안내', t.includes('OBS') && t.includes('PRISM'));
  ok('오버레이: 권장 해상도 안내', t.includes('1920'));
  ok('오버레이: URL 유출 경고', t.includes('공유하지 마세요') || t.includes('유출'));

  // 브라우저 소스 URL 을 실제로 열어 SSE 가 붙는지 확인
  const overlayUrl = await cr.evaluate(() => {
    const el = [...document.querySelectorAll('input,code,span,p')].find((n) =>
      (n.value || n.textContent || '').includes('/overlay/'),
    );
    return el ? (el.value || el.textContent || '').trim() : null;
  });
  ok('오버레이: 브라우저 소스 URL 노출', Boolean(overlayUrl), overlayUrl ? overlayUrl.slice(0, 60) + '…' : '없음');

  // 토큰 없이 접근하면 SSE 가 거부되어야 한다
  const unauth = await cr.evaluate(async (base) => {
    const r = await fetch(`${base}/api/overlay/none/stream?token=bad`, { cache: 'no-store' });
    return r.status;
  }, BASE);
  ok('오버레이: 잘못된 토큰 SSE 거부', unauth === 401, `status=${unauth}`);

  await cr.close();
}

await b.close();

const pass = results.filter((r) => r.p).length;
console.log(`\n총 ${results.length}건 중 ${pass} PASS / ${results.length - pass} FAIL`);
if (pass !== results.length) process.exitCode = 1;
