import { chromium } from 'playwright';

/**
 * 7차 E2E — 2·3·5단계 검수.
 *  - 문의 채널 일원화(/support → SupportInquiry) + 답변 알림 + 게스트 스레드 승계
 *  - 관리자 문의 검색/유형 필터
 *  - 보안: 로그인 CSRF, /api/health 축소, 정산 요청 페이지네이션
 */

const BASE = 'http://localhost:3025';
const results = [];
const ok = (n, p, d = '') => {
  results.push({ n, p, d });
  console.log(`${p ? 'PASS' : 'FAIL'} | ${n}${d ? ' | ' + d : ''}`);
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// ───────────────────────────────────────────────────────────── 1. 보안: CSRF / health
{
  // 브라우저 fetch 는 Origin 헤더를 임의로 못 바꾸므로 raw request 컨텍스트를 쓴다.
  const ctx = await b.newContext();

  const cross = await ctx.request.post(`${BASE}/api/auth/login`, {
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
    data: { email: 'admin@tornado.kr', password: 'tornado1234!' },
    failOnStatusCode: false,
  });
  ok('CSRF: 외부 Origin 로그인 403', cross.status() === 403, `status=${cross.status()}`);

  const noOrigin = await ctx.request.post(`${BASE}/api/auth/login`, {
    headers: { 'Content-Type': 'application/json' },
    data: { email: 'admin@tornado.kr', password: 'tornado1234!' },
    failOnStatusCode: false,
  });
  ok('CSRF: Origin/Referer 없으면 403 (fail-closed)', noOrigin.status() === 403, `status=${noOrigin.status()}`);

  const same = await ctx.request.post(`${BASE}/api/auth/login`, {
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    data: { email: 'admin@tornado.kr', password: 'tornado1234!' },
    failOnStatusCode: false,
  });
  ok('CSRF: 동일 출처 로그인 정상', same.status() === 200, `status=${same.status()}`);

  const logoutCross = await ctx.request.post(`${BASE}/api/auth/logout`, {
    headers: { Origin: 'https://evil.example.com' },
    failOnStatusCode: false,
  });
  ok('CSRF: 외부 Origin 로그아웃 403', logoutCross.status() === 403, `status=${logoutCross.status()}`);

  // 위 로그인으로 ctx 에 세션이 생겼으므로, 비로그인 확인은 새 컨텍스트에서 한다.
  const anon = await b.newContext();
  const health = await (await anon.request.get(`${BASE}/api/health`)).json();
  ok('health: 비로그인 응답 축소', Object.keys(health).length === 1 && 'ok' in health, JSON.stringify(health));
  await anon.close();

  // 관리자에게는 상세 진단 정보가 그대로 보여야 한다 (ctx 는 방금 관리자로 로그인된 상태)
  const adminHealth = await (await ctx.request.get(`${BASE}/api/health`)).json();
  ok('health: 관리자에게는 상세 노출', Boolean(adminHealth.providers) && Boolean(adminHealth.checks));

  await ctx.close();
}

// ───────────────────────────────────────────────────────────── 2. 비회원 /support 접수 → 위젯에서 답변 확인
const guest = await b.newPage({ viewport: { width: 1440, height: 1100 } });
const marker = `E2E7-${Date.now() % 100000}`;
let ticketId = '';

{
  await guest.goto(`${BASE}/support`);
  await guest.selectOption('select[name=category]', 'PAYMENT');
  await guest.fill('textarea[name=content]', `${marker} 결제가 두 번 된 것 같습니다. 확인 부탁드립니다.`);
  await guest.fill('input[name=transactionNo]', 'TRD-NOT-EXIST-0001');
  await guest.click('button[type=submit]');
  await guest.waitForTimeout(2500);

  const t = await guest.locator('body').innerText();
  ok('/support: 접수 완료', t.includes('문의가 접수되었습니다'));
  ok('/support: 답변 확인 경로 안내', t.includes('문의 버튼'));
  ok('/support: 거래번호 미발견 안내', t.includes('찾지 못해'));

  const m = /접수번호\s*\n?\s*([0-9A-Z]{20,})/.exec(t);
  ticketId = m ? m[1] : '';
  ok('/support: 접수번호 발급', Boolean(ticketId), ticketId);
}

// ───────────────────────────────────────────────────────────── 3. 관리자: 검색 · 유형 필터 · 답변
const admin = await b.newPage({ viewport: { width: 1500, height: 1000 } });
admin.on('dialog', (d) => d.accept());
{
  await admin.goto(`${BASE}/login`);
  await admin.fill('input[name=email]', 'admin@tornado.kr');
  await admin.fill('input[name=password]', 'tornado1234!');
  await Promise.all([admin.waitForURL(/admin/), admin.click('button[type=submit]')]);

  // 본문 검색으로 방금 접수한 문의를 찾는다
  await admin.goto(`${BASE}/admin/inquiries?q=${encodeURIComponent(marker)}`);
  const listText = await admin.locator('body').innerText();
  ok('관리자: 본문 검색으로 문의 조회', listText.includes(marker));
  ok('관리자: 문의 유형 컬럼', listText.includes('결제 오류'));
  ok('관리자: 접수 경로 표기', listText.includes('고객센터 폼'));

  // 유형 필터가 실제로 걸러내는지 (다른 유형으로 조회하면 안 나와야 한다)
  await admin.goto(`${BASE}/admin/inquiries?q=${encodeURIComponent(marker)}&category=REFUND`);
  ok('관리자: 유형 필터 동작', !(await admin.locator('body').innerText()).includes(marker));

  // 상세 진입 → 거래번호 요약 확인 → 답변 등록
  await admin.goto(`${BASE}/admin/inquiries/${ticketId}`);
  const detail = await admin.locator('body').innerText();
  ok('관리자 상세: 문의 유형 표시', detail.includes('결제 오류'));
  ok('관리자 상세: 거래번호 연결 안내', detail.includes('TRD-NOT-EXIST-0001'));
  ok('관리자 상세: 미발견 안내', detail.includes('찾지 못했습니다'));

  await admin.fill('textarea[name=body]', `${marker} 확인했습니다. 중복 결제 건은 환불 처리해 드리겠습니다.`);
  await admin.click('button:has-text("답변 등록")');
  await admin.waitForTimeout(2500);
  ok('관리자: 답변 등록', (await admin.locator('body').innerText()).includes('답변을 등록했습니다'));
}

// ───────────────────────────────────────────────────────────── 4. 비회원이 답변을 위젯에서 확인
{
  await guest.goto(`${BASE}/`);
  // 배경 폴링(1.5초 후 1회)이 미읽음 배지를 채운다
  await guest.waitForTimeout(4000);
  const badge = guest.locator('button[aria-label="문의하기"] span');
  ok('위젯: 미읽음 답변 배지', (await badge.count()) > 0 && (await badge.first().innerText()).trim() === '1');

  await guest.click('button[aria-label="문의하기"]');
  await guest.waitForTimeout(3000);
  const panel = await guest.locator('[role=dialog][aria-label="고객 문의"]').innerText();
  ok('위젯: 답변 본문 노출', panel.includes('환불 처리해 드리겠습니다'));
  ok('위젯: 내가 쓴 문의도 같은 스레드', panel.includes('결제가 두 번 된 것 같습니다'));
}

// ───────────────────────────────────────────────────────────── 5. 게스트 → 로그인 스레드 승계
{
  // 같은 브라우저 컨텍스트(게스트 쿠키 보유)에서 후원자로 로그인한다
  await guest.goto(`${BASE}/login`);
  await guest.fill('input[name=email]', 'donor@tornado.kr');
  await guest.fill('input[name=password]', 'tornado1234!');
  await Promise.all([guest.waitForURL(/\/my/), guest.click('button[type=submit]')]);

  await guest.goto(`${BASE}/`);
  await guest.click('button[aria-label="문의하기"]');
  await guest.waitForTimeout(1000);
  // 채팅 탭으로 전환
  const chatTab = guest.locator(String.raw`[role=dialog][aria-label="고객 문의"] button:has-text("1:1 문의")`);
  if ((await chatTab.count()) > 0) await chatTab.first().click();
  await guest.waitForTimeout(3000);

  const afterLogin = await guest.locator('[role=dialog][aria-label="고객 문의"]').innerText();
  ok('승계: 로그인 후에도 이전 문의 유지', afterLogin.includes('결제가 두 번 된 것 같습니다'));
  ok('승계: 관리자 답변도 유지', afterLogin.includes('환불 처리해 드리겠습니다'));
}

// ───────────────────────────────────────────────────────────── 6. /studio/reports 에 userId 미노출
{
  const cr = await b.newPage({ viewport: { width: 1400, height: 950 } });
  await cr.goto(`${BASE}/login`);
  await cr.fill('input[name=email]', 'creator1@tornado.kr');
  await cr.fill('input[name=password]', 'tornado1234!');
  await Promise.all([cr.waitForURL(/studio/), cr.click('button[type=submit]')]);
  await cr.goto(`${BASE}/studio/reports`);
  const t = await cr.locator('body').innerText();
  ok('신고 화면: 내부 userId 미노출', !t.includes('userId=') && !t.includes('회원 문의 /'));
  await cr.close();
}

// ───────────────────────────────────────────────────────────── 7. 정산 요청 페이지네이션 분리
{
  await admin.goto(`${BASE}/admin/settlements?rpage=1`);
  const t = await admin.locator('body').innerText();
  ok('정산: 요청 목록 페이지 표기', /\d+\/\d+ 페이지/.test(t));
  ok('정산: 미처리 우선 정렬 안내', t.includes('오래된 순'));

  // rpage 와 page 가 서로 독립적인 파라미터인지
  await admin.goto(`${BASE}/admin/settlements?rpage=2&page=1`);
  ok('정산: rpage 독립 파라미터', admin.url().includes('rpage=2') && admin.url().includes('page=1'));
}

// ───────────────────────────────────────────────────────────── 8. 신고(ABUSE) 는 문의 + 신고 큐 양쪽에 올라간다
{
  const reporter = await b.newPage({ viewport: { width: 1400, height: 950 } });
  const abuseMarker = `E2E7ABUSE-${Date.now() % 100000}`;
  await reporter.goto(`${BASE}/support`);
  await reporter.selectOption('select[name=category]', 'ABUSE');
  await reporter.fill('textarea[name=content]', `${abuseMarker} 방송에서 부적절한 표현이 반복됩니다. 확인 부탁드립니다.`);
  await reporter.fill('input[name=transactionNo]', '');
  await reporter.click('button[type=submit]');
  await reporter.waitForTimeout(2500);
  ok('신고: /support 접수 완료', (await reporter.locator('body').innerText()).includes('문의가 접수되었습니다'));
  await reporter.close();

  // 신고 처리 큐(Report)에도 올라와야 한다
  await admin.goto(`${BASE}/admin/moderation`);
  const t = await admin.locator('body').innerText();
  ok('신고 관리: 접수자 컬럼', t.includes('접수자'));
  ok('신고 관리: ABUSE 문의가 신고 큐에 등록', t.includes(abuseMarker));
  ok('신고 관리: 본문에 내부 식별자 없음', !t.includes('userId='));
  ok('신고 관리: 비회원 접수자 표기', t.includes('비회원'));

  // 답변 가능한 문의 스레드로도 남아야 한다
  await admin.goto(`${BASE}/admin/inquiries?q=${encodeURIComponent(abuseMarker)}`);
  const q = await admin.locator('body').innerText();
  ok('신고: 문의 스레드로도 접수', q.includes(abuseMarker));
  ok('신고: 문의 유형이 신고로 표기', q.includes('부적절한 이용 신고'));
}

// ───────────────────────────────────────────────────────────── 9. 라이브 플랫폼(유튜브/인스타/틱톡) 저장·노출
{
  const cr = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  cr.on('dialog', (d) => d.accept());
  await cr.goto(`${BASE}/login`);
  await cr.fill('input[name=email]', 'creator1@tornado.kr');
  await cr.fill('input[name=password]', 'tornado1234!');
  await Promise.all([cr.waitForURL(/studio/), cr.click('button[type=submit]')]);

  await cr.goto(`${BASE}/studio/settings?tab=page`);
  const t = await cr.locator('body').innerText();
  ok('라이브: 플랫폼 3종 선택 UI', t.includes('유튜브') && t.includes('인스타그램') && t.includes('틱톡'));

  // 잘못된 호스트는 거부되어야 한다 (엉뚱한 주소가 저장되면 후원자가 빈 페이지로 간다)
  await cr.check("input[name=livePlatform][value=INSTAGRAM]", { force: true });
  await cr.fill('input[name=instagramLiveUrl]', 'https://evil.example.com/live');
  await cr.click('button:has-text("후원페이지 설정 저장")');
  await cr.waitForTimeout(3500);
  ok('라이브: 잘못된 호스트 거부', (await cr.locator('body').innerText()).includes('instagram.com 주소만'));

  // 인스타그램을 선택하고 올바른 주소를 저장하면 후원샵이 그 링크로 연결되어야 한다
  // (검증 실패 후에는 폼이 DB 값으로 다시 그려지므로 선택을 다시 해줘야 한다)
  await cr.check("input[name=livePlatform][value=INSTAGRAM]", { force: true });
  await cr.fill('input[name=instagramLiveUrl]', 'https://www.instagram.com/donaido/live');
  const liveSwitch = cr.locator('input[name=liveOn]');
  if (!(await liveSwitch.isChecked())) await liveSwitch.check({ force: true });
  await cr.click('button:has-text("후원페이지 설정 저장")');
  await cr.waitForTimeout(3500);
  const saved = await cr.locator('body').innerText();
  ok('라이브: 인스타그램 선택 저장', saved.includes('인스타그램 라이브로 온에어'));

  // 재진입 시 선택이 유지되는지 (저장 액션이 값을 실제로 기록했는지)
  await cr.goto(`${BASE}/studio/settings?tab=page`);
  ok('라이브: 선택 플랫폼 유지', await cr.locator('input[name=livePlatform][value=INSTAGRAM]').isChecked());
  ok(
    '라이브: 주소 유지',
    (await cr.locator('input[name=instagramLiveUrl]').inputValue()) === 'https://www.instagram.com/donaido/live',
  );

  // 후원샵이 선택한 플랫폼 주소로 연결되는지
  const shop = await b.newPage({ viewport: { width: 1440, height: 1100 } });
  await shop.goto(`${BASE}/c/TOR-8K2M`);
  const href = await shop.locator('a[href*="instagram.com"]').first().getAttribute('href');
  ok('후원샵: 온에어가 인스타 라이브로 연결', href === 'https://www.instagram.com/donaido/live', href ?? 'none');
  await shop.close();

  // 원복 (유튜브)
  await cr.check("input[name=livePlatform][value=YOUTUBE]", { force: true });
  await cr.fill('input[name=instagramLiveUrl]', '');
  await cr.fill('input[name=youtubeLiveUrl]', 'https://www.youtube.com/watch?v=donaido-live');
  await cr.click('button:has-text("후원페이지 설정 저장")');
  await cr.waitForTimeout(2000);
  await cr.close();
}

// ───────────────────────────────────────────────────────────── 10. 알림(종) 복원 확인
{
  await admin.goto(`${BASE}/admin`);
  await admin.waitForTimeout(2500);
  const bell = admin.locator('button[aria-label*="알림"], [data-notification-bell]');
  const bellCount = await bell.count();
  ok('알림: 관리자 화면에 종 아이콘 존재', bellCount > 0, `count=${bellCount}`);

  const api = await admin.evaluate(async () => {
    const r = await fetch('/api/notifications', { cache: 'no-store' });
    return { status: r.status, body: r.ok ? await r.json() : null };
  });
  ok('알림: /api/notifications 응답', api.status === 200 && Array.isArray(api.body?.items), `status=${api.status}`);
  ok('알림: 새 문의 알림 수신', (api.body?.items ?? []).some((i) => String(i.title).includes('문의')), `n=${(api.body?.items ?? []).length}`);
}

await admin.close();
await guest.close();
await b.close();

const pass = results.filter((r) => r.p).length;
console.log(`\n총 ${results.length}건 중 ${pass} PASS / ${results.length - pass} FAIL`);
if (pass !== results.length) process.exitCode = 1;
