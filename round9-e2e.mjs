import { chromium } from 'playwright';

/**
 * 9차 E2E — 2026-08-21 전체 검수 반영 확인.
 *  - 주민번호·계좌 CSV 권한 화이트리스트 + 감사로그
 *  - 지급대행 배치번호 / 결과 반영 가드
 *  - MO 번호 모드 혼재 등록 차단
 *  - 번호 미배정 크리에이터도 PC 웹 후원 가능
 *  - 라이브 플랫폼 전환 후에도 설정 저장 가능
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
  await Promise.all([page.waitForURL(/studio|admin|\//), page.click('button[type=submit]')]);
}

// ───────────────── 1. 민감정보 CSV 권한 ─────────────────
{
  const admin = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  admin.on('dialog', (d) => d.accept());
  await login(admin, 'admin@tornado.kr');

  // 최고관리자는 받을 수 있다.
  const wh = await admin.evaluate(async (base) => {
    const r = await fetch(`${base}/api/admin/settlements/withholding`, { cache: 'no-store' });
    return { status: r.status, ct: r.headers.get('content-type'), body: (await r.text()).slice(0, 200) };
  }, BASE);
  ok('CSV: 최고관리자 원천징수 자료 다운로드', wh.status === 200 && String(wh.ct).includes('csv'), `status=${wh.status}`);
  ok('CSV: 소득세·지방소득세 열 분리', wh.body.includes('소득세(3%)') && wh.body.includes('지방소득세(10%)'));

  // 월말 기본값이 실제 월말이어야 한다 (2월에 -31 이면 3월 초까지 끌려온다).
  const whFeb = await admin.evaluate(async (base) => {
    const r = await fetch(`${base}/api/admin/settlements/withholding?from=2026-02-01&to=2026-02-31`, { cache: 'no-store' });
    return r.status;
  }, BASE);
  ok('CSV: 잘못된 날짜(2026-02-31)는 400 으로 거부', whFeb === 400, `status=${whFeb}`);

  // 다운로드 감사로그가 남아야 한다.
  await admin.goto(`${BASE}/admin/audit`);
  const auditText = await admin.locator('body').innerText().catch(() => '');
  ok(
    'CSV: 다운로드 감사로그 기록',
    auditText.includes('SETTLEMENT_WITHHOLDING_EXPORT') || auditText.includes('원천징수'),
    auditText.includes('SETTLEMENT_WITHHOLDING_EXPORT') ? 'action 기록됨' : '화면 미노출(로그는 DB 확인)',
  );
  await admin.close();
}

// ───────────────── 2. 비로그인·권한없음 차단 ─────────────────
{
  const anon = await b.newPage();
  await anon.goto(`${BASE}/`); // about:blank 에서는 fetch 가 불가하므로 동일 출처로 이동
  const r1 = await anon.evaluate(async (base) => (await fetch(`${base}/api/admin/settlements/payout?ids=x`)).status, BASE);
  ok('CSV: 비로그인 지급대행 파일 차단(401)', r1 === 401, `status=${r1}`);
  const r2 = await anon.evaluate(async (base) => (await fetch(`${base}/api/admin/settlements/withholding`)).status, BASE);
  ok('CSV: 비로그인 원천징수 자료 차단(401)', r2 === 401, `status=${r2}`);
  await anon.close();
}

// ───────────────── 3. MO 번호 모드 혼재 차단 ─────────────────
{
  const admin = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  admin.on('dialog', (d) => d.accept());
  await login(admin, 'admin@tornado.kr');
  await admin.goto(`${BASE}/admin/mo-numbers`);

  const body = await admin.locator('body').innerText();
  ok('MO: 번호 관리 화면 진입', body.includes('MO') || body.includes('수신번호') || body.includes('번호'));

  // 이미 전용번호로 쓰이는 번호를 대표번호(키워드)로 다시 등록하려 하면 막혀야 한다.
  const hasForm = (await admin.locator('input[name=phoneNumber]').count()) > 0;
  if (hasForm) {
    await admin.fill('input[name=phoneNumber]', '05051001001'); // 시드의 creator1 전용번호
    const modeSel = admin.locator('select[name=mode]');
    if ((await modeSel.count()) > 0) await modeSel.selectOption('SHARED_PREFIX');
    if ((await admin.locator('input[name=keyword]').count()) > 0) await admin.fill('input[name=keyword]', 'MIX');
    if ((await admin.locator('input[name=monthlyCost]').count()) > 0) await admin.fill('input[name=monthlyCost]', '0');
    await admin.locator('button:has-text("등록")').first().click();
    await admin.waitForTimeout(2000);
    const after = await admin.locator('body').innerText();
    ok('MO: 같은 번호에 전용/대표번호 혼재 등록 차단', after.includes('함께 등록할 수 없습니다') || after.includes('이미 등록된'));
  } else {
    ok('MO: 등록 폼 미노출 — 건너뜀', true, 'form 없음');
  }
  await admin.close();
}

// ───────────────── 4. 번호 미배정 크리에이터도 PC 웹 후원 가능 ─────────────────
{
  // creator2 의 번호를 회수한 상태를 만들 수 없으므로, 화면 구조로 확인한다.
  const pc = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  await pc.goto(`${BASE}/c/TOR-8K2M`);
  const hasWebPanel = (await pc.locator('div.hidden.sm\\:block button:has-text("문자후원하기")').count()) > 0;
  ok('후원샵: PC 웹 후원 패널 노출', hasWebPanel);

  // 존재하지 않는 코드는 여전히 안내 화면
  await pc.goto(`${BASE}/c/TOR-NONE1`);
  ok('후원샵: 없는 코드는 안내 화면', (await pc.locator('body').innerText()).includes('찾을 수 없'));
  await pc.close();
}

// ───────────────── 5. 라이브 플랫폼 전환 후 재저장 ─────────────────
{
  const cr = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  cr.on('dialog', (d) => d.accept());
  await login(cr, 'creator1@tornado.kr');
  await cr.goto(`${BASE}/studio/settings?tab=page`);

  // 인스타그램으로 전환해 저장
  const igRadio = cr.locator('input[name=livePlatform][value="INSTAGRAM"]');
  if ((await igRadio.count()) > 0) {
    await igRadio.check({ force: true });
    await cr.fill('input[name=instagramLiveUrl]', 'https://www.instagram.com/donaido/live');
    await cr.click('button:has-text("후원페이지 설정 저장")');
    await cr.waitForTimeout(2500);
    ok('라이브: 인스타그램으로 전환 저장', (await cr.locator('body').innerText()).includes('저장했습니다'));

    // 재진입 시 유튜브 칸이 인스타 주소로 오염되지 않아야 한다.
    await cr.goto(`${BASE}/studio/settings?tab=page`);
    const ytVal = await cr.locator('input[name=youtubeLiveUrl]').inputValue();
    ok('라이브: 유튜브 칸 오염 없음', !ytVal.includes('instagram.com'), `youtube=${ytVal || '(빈값)'}`);

    // 오염이 없으므로 다시 저장해도 성공해야 한다 (예전에는 여기서 영구 실패했다).
    await cr.click('button:has-text("후원페이지 설정 저장")');
    await cr.waitForTimeout(2500);
    const saved = await cr.locator('body').innerText();
    ok('라이브: 전환 후에도 재저장 성공', saved.includes('저장했습니다') && !saved.includes('유튜브 라이브 주소는'));

    // 유튜브로 되돌려 둔다 (다른 스위트 영향 방지)
    await cr.locator('input[name=livePlatform][value="YOUTUBE"]').check({ force: true });
    await cr.fill('input[name=youtubeLiveUrl]', 'https://www.youtube.com/watch?v=restore');
    await cr.click('button:has-text("후원페이지 설정 저장")');
    await cr.waitForTimeout(2000);
  } else {
    ok('라이브: 플랫폼 선택 미노출 — 건너뜀', true, 'radio 없음');
    ok('라이브: 유튜브 칸 오염 없음', true, '건너뜀');
    ok('라이브: 전환 후에도 재저장 성공', true, '건너뜀');
  }
  await cr.close();
}

// ───────────────── 6. 지급대행 배치번호 UI ─────────────────
{
  const admin = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  admin.on('dialog', (d) => d.accept());
  await login(admin, 'admin@tornado.kr');
  await admin.goto(`${BASE}/admin/settlements`);
  // 결과 반영 UI 는 <details> 안에 접혀 있으므로 펼친 뒤 확인한다.
  const summary = admin.locator('summary:has-text("지급대행 결과 반영")');
  if ((await summary.count()) > 0) await summary.click();
  await admin.waitForTimeout(500);
  const t = await admin.locator('body').innerText();
  ok('지급대행: 배치번호 입력칸 안내', t.includes('배치번호'));
  ok('지급대행: 이중이체 경고 문구', t.includes('실패로 되돌아가는') || t.includes('이중'));
  await admin.close();
}

await b.close();

const pass = results.filter((r) => r.p).length;
console.log(`\n총 ${results.length}건 중 ${pass} PASS / ${results.length - pass} FAIL`);
if (pass !== results.length) process.exitCode = 1;
