import { chromium } from 'playwright';
const BASE='http://localhost:3025';
const results=[]; const ok=(n,p,d='')=>{results.push({n,p});console.log(`${p?'PASS':'FAIL'} | ${n}${d?' | '+d:''}`);};
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport:{width:1500,height:950} });
const page = await ctx.newPage();
page.on('dialog',(d)=>d.accept());

// 관리자 로그인
await page.goto(`${BASE}/login`);
await page.fill('input[name=email]','admin@tornado.kr');
await page.fill('input[name=password]','tornado1234!');
await Promise.all([page.waitForURL(/admin/,{timeout:15000}),page.click('button[type=submit]')]);
ok('관리자 로그인', page.url().includes('/admin'));

// 1. 한도 정책 페이지: 새 필드 노출 + 전역 정책 등록(횟수 제한 포함)
await page.goto(`${BASE}/admin/policies`);
ok('정책: 1인 1일 최대 건수 필드', (await page.locator('input[name=donorDailyMaxCount]').count())>0);
// 활성 전역 정책은 1개만 허용되므로(의도된 제약), 기존 전역 정책을 수정하는 경로로 검증한다.
const editForm = page.locator('form').filter({ has: page.locator('button:has-text("변경 저장")') }).first();
await editForm.locator('input[name=donorDailyMaxCount]').fill('25');
await editForm.locator('button:has-text("변경 저장")').click();
await page.waitForTimeout(2500);
const pbody = await page.locator('body').innerText();
ok('정책: 1인 1일 최대 건수 저장', pbody.includes('한도 정책을 저장했습니다'), pbody.match(/정책[^\n]*습니다/)?.[0]??'');
await page.reload();
const savedCount = await page.locator('form').filter({ has: page.locator('button:has-text("변경 저장")') }).first().locator('input[name=donorDailyMaxCount]').inputValue();
ok('정책: 저장값 유지(25)', savedCount === '25', savedCount);
// 중복 전역 정책 등록이 차단되는지도 확인
const form = page.locator('form').filter({ has: page.locator('select[name=scope]') }).first();
await form.locator('select[name=scope]').selectOption('GLOBAL');
await form.locator('button:has-text("정책 등록")').click();
await page.waitForTimeout(2500);
ok('정책: 활성 전역 정책 중복 차단', (await page.locator('body').innerText()).includes('활성 전역 정책이 이미 있습니다'));

// 2. 크리에이터 목록: 공통 범위 일괄 적용
await page.goto(`${BASE}/admin/creators`);
ok('크리에이터: 일괄 적용 카드', (await page.locator('text=1건 후원금 허용 범위 공통 적용').count())>0);
const bulk = page.locator('form').filter({ has: page.locator('button:has-text("전체 적용")') }).first();
await bulk.locator('input[name=minAmount]').fill('1000');
await bulk.locator('input[name=maxAmount]').fill('40000');
await bulk.locator('button:has-text("전체 적용")').click();
await page.waitForTimeout(2500);
const cbody = await page.locator('body').innerText();
ok('크리에이터: 일괄 적용 실행', cbody.includes('허용 범위 1,000원 ~ 40,000원을 적용') || /전체에 1건 후원금 허용 범위/.test(cbody), cbody.match(/크리에이터 \d+명 전체[^\n]*/)?.[0]??'');

// 3. 크리에이터 상세: 개별 범위 변경
const row = page.locator('a', { hasText: '바람소리' }).first();
await row.click();
await page.waitForTimeout(1500);
ok('상세: 범위 변경 폼', (await page.locator('text=1건 후원금 허용 범위 변경').count())>0);
const bform = page.locator('form').filter({ has: page.locator('button:has-text("범위 저장")') }).first();
await bform.locator('input[name=minAmount]').fill('2000');
await bform.locator('input[name=maxAmount]').fill('30000');
await bform.locator('button:has-text("범위 저장")').click();
await page.waitForTimeout(2500);
const dbody = await page.locator('body').innerText();
ok('상세: 범위 저장', dbody.includes('허용 범위를 변경했습니다') || dbody.includes('보정했습니다'), dbody.match(/님의[^\n]*변경[^\n]*/)?.[0]??'');

// 로그아웃 → 크리에이터로 설정 검증
await ctx.clearCookies();
await page.goto(`${BASE}/login`);
await page.fill('input[name=email]','creator1@tornado.kr');
await page.fill('input[name=password]','tornado1234!');
await Promise.all([page.waitForURL(/studio/,{timeout:15000}),page.click('button[type=submit]')]);
await page.goto(`${BASE}/studio/settings`);
const sbody = await page.locator('body').innerText();
ok('스튜디오: 유효 범위 표시', sbody.includes('2,000원 ~ 30,000원'), sbody.match(/설정 가능 범위[^\n]*/)?.[0]??'');
// 범위 밖 금액 저장 시도 → 거부
await page.fill('input[name=donationAmount]','40000');
await page.click('button:has-text("후원금 저장")');
await page.waitForTimeout(2000);
ok('스튜디오: 범위 밖 금액 거부', (await page.locator('body').innerText()).includes('2000원 ~ 30000원 사이에서만'));
// 범위 안 금액 저장 → 성공
await page.fill('input[name=donationAmount]','3000');
await page.click('button:has-text("후원금 저장")');
await page.waitForTimeout(2000);
ok('스튜디오: 범위 안 금액 저장', (await page.locator('body').innerText()).includes('저장했습니다'));

// 4. 새 로고 렌더 확인 (메인 + 크리에이터 페이지 무영향)
const home = await ctx.newPage();
await home.goto(`${BASE}/`);
ok('로고: DONAIDO 워드마크', (await home.locator('header').first().innerText()).includes('DONAIDO') || (await home.locator('body').innerText()).includes('DONAIDO'));
await home.screenshot({ path: '/tmp/home-new-logo.png' });
await home.close();

const fails=results.filter(r=>!r.p);
console.log(`\n총 ${results.length}건 중 ${results.length-fails.length} PASS / ${fails.length} FAIL`);
await browser.close();
process.exit(fails.length?1:0);
