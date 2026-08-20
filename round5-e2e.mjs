import { chromium } from 'playwright';
const BASE='http://localhost:3025';
const results=[]; const ok=(n,p,d='')=>{results.push({n,p,d});console.log(`${p?'PASS':'FAIL'} | ${n}${d?' | '+d:''}`);};
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport:{width:1500,height:950} });
const page = await ctx.newPage();
page.on('dialog',(d)=>d.accept());

await page.goto(`${BASE}/login`);
await page.fill('input[name=email]','creator1@tornado.kr');
await page.fill('input[name=password]','tornado1234!');
await Promise.all([page.waitForURL(/studio/),page.click('button[type=submit]')]);

// 1. 내비게이션: 설정 메뉴 + 정산 계좌 제거
const navText = await page.locator('aside').first().innerText();
ok('내비: 설정 메뉴', navText.includes('설정'));
ok('내비: 프로필·코드 제거', !navText.includes('프로필·코드'));
ok('내비: 정산 계좌 항목 제거', !navText.includes('정산 계좌'));

// 2. 설정 페이지 구성 (후원샵 꾸미기는 후원 설정 > 후원샵 관리로 이동됨)
await page.goto(`${BASE}/studio/profile`);
ok('설정: 페이지 제목', (await page.locator('h1').first().innerText()).includes('설정'));

await page.goto(`${BASE}/studio/settings?tab=page`);
const pbody = await page.locator('body').innerText();
ok('후원샵 관리: 후원샵 URL 노출', pbody.includes('/c/TOR-8K2M'));
ok('후원샵 관리: 라이브 링크 입력', (await page.locator('input[name=youtubeLiveUrl]').count())>0);
ok('후원샵 관리: 링크 옆 스위치', (await page.locator('input[name=liveOn].peer').count())>0);

// 스위치 켜기 → /c 반영
await page.fill('input[name=youtubeLiveUrl]','https://www.youtube.com/watch?v=round5');
await page.locator('input[name=liveOn]').check({ force: true });
await page.click('button:has-text("후원페이지 설정 저장")');
await page.waitForTimeout(2500);
ok('후원샵 관리: 방송중 저장', (await page.locator('body').innerText()).includes('온에어 표시가 켜졌습니다'));

const c = await ctx.newPage();
await c.goto(`${BASE}/c/TOR-8K2M`);
ok('/c: 라이브중 배지', (await c.locator('a:has-text("ON AIR")').count())>0);
ok('/c: 두근두근 효과', (await c.locator('header .animate-heartbeat').count())>0);
await c.close();

// 스위치 끄기(원상복구) + 라이브 링크 수정 가능 확인
await page.goto(`${BASE}/studio/settings?tab=page`);
await page.fill('input[name=youtubeLiveUrl]','https://www.youtube.com/watch?v=changed-link');
await page.locator('input[name=liveOn]').uncheck({ force: true });
await page.click('button:has-text("후원페이지 설정 저장")');
await page.waitForTimeout(2500);
await page.reload();
ok('후원샵 관리: 라이브 링크 수정 유지', (await page.locator('input[name=youtubeLiveUrl]').inputValue()).includes('changed-link'));

// 3. 정산 관리: 캘린더 + 통합 계좌
await page.goto(`${BASE}/studio/settlement`);
const sbody = await page.locator('body').innerText();
const now = new Date(Date.now() + 9*3600e3);
ok('정산: 캘린더 월 표기', sbody.includes(`${now.getUTCFullYear()}년 ${now.getUTCMonth()+1}월`));
ok('정산: 요일 헤더', sbody.includes('일') && sbody.includes('토'));
ok('정산: 일별 후원 합계 표시', /\d+건/.test(sbody));
ok('정산: 월 후원 합계 타일', sbody.includes('월 후원 합계'));
await page.goto(`${BASE}/studio/settlement?tab=account`);
ok('정산: 계좌 탭(은행 선택)', (await page.locator('select[name=bankCode]').count())>0);
await page.goto(`${BASE}/studio/settlement?tab=request`);
ok('정산: 요청 탭', (await page.locator('body').innerText()).includes('정산 요청'));
// 월 이동 (캘린더는 현황 탭)
await page.goto(`${BASE}/studio/settlement?tab=overview`);
await page.click('a[aria-label="이전 달"]');
await page.waitForTimeout(1200);
const prevMonth = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();
ok('정산: 이전 달 이동', (await page.locator('body').innerText()).includes(`${prevMonth}월`));
await page.click('a:has-text("이번 달")');
await page.waitForTimeout(1000);

// 4. 구 정산계좌 URL 리다이렉트
await page.goto(`${BASE}/studio/settlement/account`);
await page.waitForTimeout(800);
ok('정산계좌 URL 리다이렉트', page.url().includes('/studio/settlement'));

// 5. 사이드바 단일 활성
const cls = async (label) => (await page.locator(`aside a:has-text("${label}")`).first().getAttribute('class')) ?? '';
await page.goto(`${BASE}/studio/settlement`);
ok('사이드바: 정산 관리만 활성', (await cls('정산 관리')).includes('bg-brand-100') && !(await cls('대시보드')).includes('bg-brand-100'));
await page.goto(`${BASE}/studio/profile`);
const exactCls = async (label) => (await page.locator('aside a', { hasText: new RegExp(`^${label}$`) }).first().getAttribute('class')) ?? '';
ok('사이드바: 설정만 활성', (await exactCls('설정')).includes('bg-brand-100') && !(await cls('대시보드')).includes('bg-brand-100') && !(await exactCls('후원 설정')).includes('bg-brand-100'));
await page.goto(`${BASE}/studio`);
ok('사이드바: 대시보드는 대시보드에서만', (await cls('대시보드')).includes('bg-brand-100'));

// 스크린샷
await page.goto(`${BASE}/studio/settlement`);
await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/settlement-calendar.png', fullPage: false });
await page.goto(`${BASE}/studio/profile`);
await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/studio-settings.png', fullPage: false });

const fails=results.filter(r=>!r.p);
console.log(`\n총 ${results.length}건 중 ${results.length-fails.length} PASS / ${fails.length} FAIL`);
if(fails.length) fails.forEach(f=>console.log('  FAIL:',f.n,f.d));
await browser.close();
process.exit(fails.length?1:0);
