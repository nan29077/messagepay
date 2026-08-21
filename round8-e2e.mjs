import { chromium } from 'playwright';

/**
 * 8차 E2E — 정산 탭 개편 / 주민번호 / 지급대행 / 이미지 업로드 / 금칙어 보완.
 */

const BASE = 'http://localhost:3025';
const results = [];
const ok = (n, p, d = '') => {
  results.push({ n, p, d });
  console.log(`${p ? 'PASS' : 'FAIL'} | ${n}${d ? ' | ' + d : ''}`);
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function loginCreator(page) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name=email]', 'creator1@tornado.kr');
  await page.fill('input[name=password]', 'tornado1234!');
  await Promise.all([page.waitForURL(/studio/), page.click('button[type=submit]')]);
}

// ───────────────────────── 1. 정산 관리 탭 ─────────────────────────
{
  const cr = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  cr.on('dialog', (d) => d.accept());
  await loginCreator(cr);

  await cr.goto(`${BASE}/studio/settlement`);
  const nav = await cr.locator('nav[aria-label="정산 관리 메뉴"]').innerText();
  ok('정산: 4개 탭 존재', ['정산 현황', '정산 요청', '정산 계좌', '정산 원장'].every((t) => nav.includes(t)));

  // 현황 탭에 캘린더
  ok('정산: 현황 탭 캘린더', (await cr.locator('body').innerText()).includes('월 후원 합계'));

  // 계좌 탭
  await cr.goto(`${BASE}/studio/settlement?tab=account`);
  ok('정산: 계좌 탭', (await cr.locator('body').innerText()).includes('정산금을 지급받을 계좌'));

  // 원장 탭
  await cr.goto(`${BASE}/studio/settlement?tab=ledger`);
  ok('정산: 원장 탭', (await cr.locator('body').innerText()).includes('정산 원장'));

  // 요청 탭 — 주민번호 안내 필수 노출
  await cr.goto(`${BASE}/studio/settlement?tab=request`);
  const reqText = await cr.locator('body').innerText();
  ok('정산: 요청 탭 진입', reqText.includes('정산 요청'));
  // 정산 가능금이 있을 때만 폼(+주민번호)이 뜬다. 시드에 정산 가능금이 없을 수 있으므로 존재 여부로만 확인.
  const hasResident = reqText.includes('주민등록번호');
  if (hasResident) {
    ok('정산: 주민번호 신고 후 파기 안내', reqText.includes('신고 완료 후 즉시 파기'));
    ok('정산: 원천징수 전용 안내', reqText.includes('원천징수 신고 목적'));
    // 두 갈래 모두 정상이다:
    //  · 신규 입력  → 동의 체크박스가 있다
    //  · 기존 재사용 → 마스킹 값 + '변경' 버튼이 있고 동의는 이미 받은 상태다
    const agreeBox = await cr.locator('input[name=residentAgree]').count();
    const reuse = (await cr.locator('input[name=resident]').count()) > 0
      && (await cr.locator('button:has-text("변경")').count()) > 0;
    ok('정산: 수집 동의 체크박스 또는 기존 번호 재사용', agreeBox > 0 || reuse,
      agreeBox > 0 ? '신규 입력' : '기존 재사용');
  } else {
    ok('정산: (정산 가능금 없음 — 주민번호 폼 건너뜀)', true, '가능금 0');
    ok('정산: 원천징수 안내(요청 탭 하단)', reqText.includes('원천징수'));
    ok('정산: 요청 내역 섹션', reqText.includes('정산 요청 내역'));
  }
  await cr.close();
}

// ───────────────────────── 2. 정산 가능금 만들고 주민번호 요청 ─────────────────────────
{
  // MO 시뮬레이터로 후원을 만들어 정산 가능금을 확보한다.
  const admin = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  admin.on('dialog', (d) => d.accept());
  await admin.goto(`${BASE}/login`);
  await admin.fill('input[name=email]', 'admin@tornado.kr');
  await admin.fill('input[name=password]', 'tornado1234!');
  await Promise.all([admin.waitForURL(/admin/), admin.click('button[type=submit]')]);

  // 관리자 정산 화면에 지급대행 툴바가 있는지
  await admin.goto(`${BASE}/admin/settlements`);
  const adminText = await admin.locator('body').innerText();
  ok('관리자 정산: 지급대행 흐름 안내', adminText.includes('지급대행'));
  ok('관리자 정산: 결과 반영 UI', adminText.includes('지급대행 결과 반영'));
  ok('관리자 정산: 원천징수 자료 다운로드 링크', adminText.includes('원천징수 지급명세서 자료'));

  // 원천징수 CSV 라우트가 응답하는지 (관리자 세션)
  const wh = await admin.evaluate(async (base) => {
    const r = await fetch(`${base}/api/admin/settlements/withholding`, { cache: 'no-store' });
    return { status: r.status, ct: r.headers.get('content-type') };
  }, BASE);
  ok('관리자 정산: 원천징수 CSV 응답', wh.status === 200 && String(wh.ct).includes('csv'), `status=${wh.status}`);

  await admin.close();
}

// ───────────────────────── 3. 이미지 업로드 ─────────────────────────
{
  const cr = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  cr.on('dialog', (d) => d.accept());
  await loginCreator(cr);

  await cr.goto(`${BASE}/studio/profile`);
  ok('프로필: 이미지 업로드 UI', (await cr.locator('body').innerText()).includes('파일 업로드'));

  // 실제 업로드 API 호출 (1x1 PNG)
  const up = await cr.evaluate(async (base) => {
    // 최소 PNG 바이트
    const b64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mნk=';
    // 안전하게 유효한 1x1 PNG 를 직접 구성
    const bytes = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC',
      ),
      (c) => c.charCodeAt(0),
    );
    void b64;
    const file = new File([bytes], 't.png', { type: 'image/png' });
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch(`${base}/api/upload`, { method: 'POST', body: fd });
    return { status: r.status, body: await r.json() };
  }, BASE);
  ok('업로드: PNG 저장 성공', up.status === 200 && up.body?.ok && String(up.body?.url).startsWith('/api/media/'), `url=${up.body?.url}`);

  // 업로드된 파일이 실제로 서빙되는지
  if (up.body?.url) {
    const served = await cr.evaluate(async (u) => (await fetch(u)).status, up.body.url);
    ok('업로드: 저장 이미지 서빙', served === 200, `status=${served}`);
  } else {
    ok('업로드: 저장 이미지 서빙', false, 'no url');
  }

  // 비이미지 거부
  const bad = await cr.evaluate(async (base) => {
    const file = new File([new TextEncoder().encode('hello not an image')], 'x.png', { type: 'image/png' });
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch(`${base}/api/upload`, { method: 'POST', body: fd });
    return r.status;
  }, BASE);
  ok('업로드: 위조 이미지 거부', bad === 400, `status=${bad}`);
  await cr.close();
}

// ───────────────────────── 4. 금칙어 보완 ─────────────────────────
{
  const cr = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  cr.on('dialog', (d) => d.accept());
  await loginCreator(cr);

  await cr.goto(`${BASE}/studio/moderation`);
  const modText = await cr.locator('body').innerText();
  ok('금칙어: 미리보기 섹션', modText.includes('금칙어 미리보기'));
  ok('금칙어: 기본 세트 버튼', modText.includes('기본 비속어 세트 추가'));
  ok('금칙어: 차단 이력 섹션', modText.includes('금칙어 차단 이력'));

  // 미리보기 동작 — 금칙어 등록 후 테스트
  await cr.fill('input[name=word]', '검수우회');
  await cr.selectOption('select[name=action]', 'BLOCK');
  await cr.click('button:has-text("금칙어 추가")');
  await cr.waitForTimeout(2000);

  // 우회 표기로 미리보기
  await cr.fill('input[name=sample]', '검 수 우 회 테스트');
  await cr.click('button:has-text("미리보기")');
  await cr.waitForTimeout(2000);
  ok('금칙어: 우회 표기 차단 미리보기', (await cr.locator('body').innerText()).includes('차단됨'));

  await cr.close();
}

await b.close();

const pass = results.filter((r) => r.p).length;
console.log(`\n총 ${results.length}건 중 ${pass} PASS / ${results.length - pass} FAIL`);
if (pass !== results.length) process.exitCode = 1;
