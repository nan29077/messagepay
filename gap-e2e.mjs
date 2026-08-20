import { chromium } from 'playwright';
const BASE='http://localhost:3025';
const results=[]; const ok=(n,p,d='')=>{results.push({n,p,d});console.log(`${p?'PASS':'FAIL'} | ${n}${d?' | '+d:''}`);};
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// 1. PC 후원샵 mock 안내 + 기기별 후원방법
const pc = await b.newPage({ viewport:{width:1440,height:1100} });
await pc.goto(`${BASE}/c/TOR-8K2M`);
const pcT = await pc.locator('body').innerText();
ok('PC: mock 결제 안내 표시', pcT.includes('모의(mock) 결제'));
ok('PC: 웹 후원 기준 안내', pcT.includes('금액과 응원 메시지를 고릅니다') && pcT.includes('본인 인증 후 바로 결제'));
ok('PC: 문자 기준 안내 미노출', !pcT.includes('첫 문자를 보내면 오는 안내'));
await pc.close();

const mob = await b.newPage({ viewport:{width:390,height:844} });
await mob.goto(`${BASE}/c/TOR-8K2M`);
const mT = await mob.locator('body').innerText();
ok('모바일: 문자 기준 안내 유지', mT.includes('첫 문자를 보내면 오는 안내'));
ok('모바일: 웹 전용 문구 미노출', !mT.includes('금액과 응원 메시지를 고릅니다'));
await mob.close();

// 2. 크리에이터: 소개 일원화 + 후원샵 관리 저장
const cr = await b.newPage({ viewport:{width:1500,height:950} });
cr.on('dialog',(d)=>d.accept());
await cr.goto(`${BASE}/login`);
await cr.fill('input[name=email]','creator1@tornado.kr');
await cr.fill('input[name=password]','tornado1234!');
await Promise.all([cr.waitForURL(/studio/),cr.click('button[type=submit]')]);

await cr.goto(`${BASE}/studio/profile`);
ok('설정: 소개 필드 중복 제거', (await cr.locator('textarea[name=description]').count())===0);

await cr.goto(`${BASE}/studio/settings?tab=page`);
const intro = `검수용 소개 ${Date.now()%10000}`;
await cr.fill('textarea[name=description]', intro);
await cr.click('button:has-text("후원페이지 설정 저장")');
await cr.waitForTimeout(2500);
ok('후원샵 관리: 소개 저장', (await cr.locator('body').innerText()).includes('후원샵 설정을 저장했습니다'));

// 프로필 저장이 소개를 지우지 않는지 (핵심 회귀)
await cr.goto(`${BASE}/studio/profile`);
await cr.click('button:has-text("프로필 저장")');
await cr.waitForTimeout(2500);
await cr.goto(`${BASE}/studio/settings?tab=page`);
ok('프로필 저장 후 소개 유지', (await cr.locator('textarea[name=description]').inputValue()) === intro);

const shop = await b.newPage({ viewport:{width:1440,height:1000} });
await shop.goto(`${BASE}/c/TOR-8K2M`);
ok('/c: 후원샵 소개 반영', (await shop.locator('header').innerText()).includes(intro));
await shop.close();

// 3. 스튜디오 후원내역 채널 표시
await cr.goto(`${BASE}/studio/donations`);
const dT = await cr.locator('body').innerText();
ok('스튜디오: 접수 채널 컬럼', dT.includes('접수') && (dT.includes('문자(MO)') || dT.includes('웹(PC)')));

// 4. 관리자: 문의 대기 타일 + 050 검증 + 결제 채널
const ad = await b.newPage({ viewport:{width:1500,height:1000} });
ad.on('dialog',(d)=>d.accept());
await ad.goto(`${BASE}/login`);
await ad.fill('input[name=email]','admin@tornado.kr');
await ad.fill('input[name=password]','tornado1234!');
await Promise.all([ad.waitForURL(/admin/),ad.click('button[type=submit]')]);
ok('관리자 대시보드: 답변 대기 문의 타일', (await ad.locator('body').innerText()).includes('답변 대기 문의'));

await ad.goto(`${BASE}/admin/payments`);
const pT = await ad.locator('body').innerText();
ok('관리자 결제: 채널 표기', pT.includes('문자(MO) 후원') || pT.includes('웹(PC) 후원'));

await ad.goto(`${BASE}/admin/mo-numbers`);
await ad.fill('input[name=phoneNumber]','15881234');
await ad.fill('input[name=monthlyCost]','0');
await ad.click('button:has-text("재고 등록")');
await ad.waitForTimeout(2000);
ok('관리자: 050 아닌 번호 거부', (await ad.locator('body').innerText()).includes('050 으로 시작'));
await ad.fill('input[name=phoneNumber]','05051239999');
await ad.click('button:has-text("재고 등록")');
await ad.waitForTimeout(2000);
ok('관리자: 050 번호 등록 허용', (await ad.locator('body').innerText()).includes('05051239999'));

const fails=results.filter(r=>!r.p);
console.log(`\n총 ${results.length}건 중 ${results.length-fails.length} PASS / ${fails.length} FAIL`);
if(fails.length) fails.forEach(f=>console.log('  FAIL:',f.n,f.d));
await b.close();
process.exit(fails.length?1:0);
