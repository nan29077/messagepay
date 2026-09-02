# 메시지페이(MESSAGEPAY) — 개발 가이드

문자 한 통으로 끝나는 결제·충전 서비스(문자PG). 가맹 서비스의 포인트·캐시를 문자로 충전한다. 이 문서는 이 저장소에서 작업할 때의 규칙입니다.

로컬 작업 폴더는 `E:\프로젝트\메시지페이`, 원격은 `github.com/nan29077/messagepay` 다.

브랜드 표기는 한글 **메시지페이**, 영문 **MESSAGEPAY**, 식별자 슬러그 `messagepay` 로 통일한다. 코드·자산·시드·문서에 `tornado` / `donaido` / `도네이도` / `토네이도` / `munjapay` / `MUNJAPAY` / `문자페이` / `MJP` 를 다시 만들지 않는다.

식별자 체계: 시드 계정 도메인 `@messagepay.kr`, 시드 비밀번호 `messagepay1234!`, 가맹점 코드 `MSG-XXXX`, PG 주문번호 접두 `MSG`, 거래번호 `TRD-`(브랜드 무관, 유지), 쿠키 `messagepay_inquiry`·`messagepay_session`·`messagepay_social_*`, 서명 헤더 `x-messagepay-signature`, 잠금 파일 `.messagepay-server.lock`, 도커 프로젝트/컨테이너/DB/볼륨 `messagepay*`.

구브랜드가 남아 있는 예외 두 곳은 적용 이력이라 그대로 둔다:
- `prisma/migrations/20260819100000_init_tornado` 폴더명과 그 안의 SQL.
- `prisma/migrations/**/*.sql` 안의 `munjapay_block_ledger_mutation` 트리거 함수명 등 구브랜드 식별자. 바꾸려면 기존 SQL 을 고치지 말고 새 마이그레이션을 추가한다.
- `prisma/seed-version.mjs` 의 시드 버전 이력 주석(8번 줄). 지난 버전이 무엇이었는지 남기는 기록이다.

`public/_legacy-munjapay/` 는 코드에서 참조하지 않는 구브랜드 이미지 보관함이다. 새 코드에서 참조하지 않는다.

## 절대 규칙

1. **이모지를 사용하지 않는다.** 아이콘은 lucide-react 라인 아이콘만 사용한다 (size 16~20, strokeWidth 1.6~1.7). lucide-react v1 에는 브랜드 아이콘(Youtube 등)이 없다.
2. **실제 계약/키가 없는 외부 연동을 성공 처리하지 않는다.** 어댑터 인터페이스 + mock 구현으로만 처리하고, 화면에 mock 임을 명시한다.
3. **결제 성공과 충전 반영 성공을 같은 상태로 취급하지 않는다.** 가맹 서비스 반영 실패가 결제 결과를 바꾸지 않는다.
4. **문자 한 건이 여러 번 결제되는 상황을 최우선으로 방지한다.** (멱등성 4중 방어 — `docs/02_아키텍처.md` 참고)
5. **정산 원장(`settlement_ledger`)은 append-only.** DB 트리거로 UPDATE/DELETE 가 차단되어 있다. 정정은 반대분개로 처리한다.
6. **개인정보/금융정보는 해시 + 암호화 + 마스킹 3분리 저장.** 화면과 로그에는 마스킹된 값만 노출한다.
7. `DIRECT_TRIGGER`(MO 수신 즉시 결제)는 `ALLOW_DIRECT_TRIGGER=true` 이면서 금융사 서면승인이 등록된 경우에만 사용한다. 기본값은 `CONFIRM_LINK`.
8. **수수료는 부가세 포함 요율로 운영하고, 공급가액과 부가세는 항상 분리해 기록한다.**
   - 운영 기본은 `vatIncluded = true` — 입력한 요율이 부가세까지 포함한 최종 차감률이다. (예: 5.5% -> 5.5% 차감)
   - 어느 방식이든 원장에는 공급가액과 부가세를 나눠 남긴다. 부가세를 0원으로 기록하면 세금계산서 근거가 사라진다.
   - 관리자 화면의 요율 입력·표시 단위는 **퍼센트**다. 저장은 소수 문자열(`percentRate` / `percentToDecimalString`).
   - 정책의 적용 여부는 `active` 플래그가 아니라 `effectiveFrom` / `effectiveTo` 로 판단한다. `active` 는 "수동 마감 여부"만 뜻한다.

## 용어

화면·문구·주석 모두 이 용어를 쓴다. 도네이도에서 온 옛 용어를 되살리지 않는다.

| 옛 용어 | 쓰는 용어 |
|---|---|
| 크리에이터 | 가맹점 |
| 후원자 | 이용자 |
| 후원 | 결제(돈을 내는 행위) / 충전(가맹 서비스에 반영되는 결과) |
| 후원샵 | 결제 페이지 |
| 방송 노출 | 충전 반영 |
| Donation / DonorProfile / CreatorProfile | Charge / PayerProfile / MerchantProfile |
| 상품 설정 | 상품 관리 (`/studio/products`) |
| 주문·배송 | 주문·판매 (`/studio/orders`) |
| 결제 설정 | 판매 설정 (`/studio/settings`) |
| 비실물 | 비실물(컨텐츠) — 화면 문구는 괄호까지 함께 쓴다 |
| 포인트 지급(상태 문구) | 지급 대기 / 지급 완료 / 지급 보류 (`pointStatusLabel`) |

DB 모델·테이블·컬럼도 2026-08-31 에 같은 기준으로 개명했다: `Charge`(charge) · `MerchantProfile`(merchant_profile) · `PayerProfile`(payer_profile) · `merchantId` · `payerId` · `chargeId`. 라우트도 `/studio/charges` · `/admin/merchants` · `/admin/payers` · `/merchant-apply` 다.

## 가맹점 콘솔 구조 (2026-09-02 개편)

`판매` 그룹은 업무 흐름대로 셋으로 나눈다. 화면을 새로 만들 때 이 경계를 넘지 않는다.

| 메뉴 | 경로 | 맡는 것 |
|---|---|---|
| 상품 관리 | `/studio/products` (목록) · `/new` · `/[id]` | 무엇을 파는가. 목록과 등록/수정 폼은 반드시 분리한다 |
| 주문·판매 | `/studio/orders?tab=delivery\|digital\|return` | 어떻게 처리하는가. 실물 배송 · 비실물 지급 · 반품/교환 |
| 판매 설정 | `/studio/settings?tab=amount\|shipping\|message\|page\|api\|channel` | 어떤 조건으로 파는가. **배송 정책은 상품이 아니라 여기 있다** |

규칙:
- **배송지 원문(`receiverEnc`/`phoneEnc`/`addressEnc`)은 목록에서 자동 복호화하지 않는다.** 마스킹 컬럼을 쓰고, `revealShipmentAddressAction` 으로 열람할 때마다 감사로그(`SHIPMENT_ADDRESS_VIEW`)를 남긴다. 주문서 CSV 내려받기도 `SHIPMENT_EXPORT` 로 기록한다.
- **실물 주문은 `pointStatus = SKIPPED`.** 금액 확정(`charge-select.ts`)에서 정한다. 기본값 PENDING 으로 두면 실물 주문이 지급 대기 목록과 파트너 API `status=pending` 에 섞인다.
- **옵션 JSON 은 값별 객체 형식**이다: `[{ name, values: [{ label, addPrice, soldOut }] }]`. 구 형식(문자열 배열)도 `parseOptions` 가 읽는다. 옵션값별 *수량* 재고는 두지 않는다(재고는 상품 단위, 값 단위는 품절 플래그만).
- **옵션 추가금·배송비는 화면 값을 믿지 않고 서버가 다시 계산한다** (`optionAddPrice` + `quoteShipping`).
- 가맹점은 환불을 실행할 수 없고 **요청만** 한다(`requestChargeRefundAction` → 관리자 승인).
- 상품 보관은 되돌릴 수 있다(`restoreChargeProductAction`). 단방향 삭제를 다시 만들지 않는다.

## 기술 스택

- Next.js 16 (App Router) / React 19 / TypeScript / Tailwind CSS v4
- Prisma 7 + PostgreSQL 16 (Amazon RDS / Aurora PostgreSQL 호환)
- Redis (ElastiCache) — 한도 카운터, 속도 제한
- Vitest (DB 통합 테스트)

## 디렉터리

```
prisma/            스키마, 마이그레이션, 시드
src/lib/           env, crypto, id, money, datetime, labels, logger
src/server/        db, auth, adapters/*, services/*
src/app/           라우트 (공개 / c / r / my / studio(가맹점 콘솔) / admin / api)
src/components/    ui(공용), layout, brand, public, my, studio, admin
tests/             핵심 흐름 통합 테스트
docs/              분석·설계 보고서, 운영 문서
```

## 실행 방법

루트 배치 파일은 번호가 붙은 3개가 기본이고, 나머지는 `도구_` 접두사를 쓴다.

- **`1_미리보기실행.bat`** (또는 `npm run preview`) — Docker/PostgreSQL 설치 없이 내장 DB(PGlite)로 실행. 포트 3030.
  - 프로덕션 빌드 방식이라 소스가 바뀌면 재빌드(1~3분)를 한다. 실제 서비스와 같은 조건으로 최종 확인할 때 쓴다.
- **`2_개발서버실행.bat`** — 실제 PostgreSQL + Redis 를 쓰는 개발 서버. 처음에는 `도구_DB시작.bat` -> `도구_최초설치.bat` 순으로 준비한다.
- **`3_서버종료.bat`** — 창을 닫아도 남아 있는 서버를 정리한다. 창을 정상적으로 닫으면 서버도 함께 종료된다.
- **`도구_수정즉시반영.bat`** — 저장하면 서버 재시작 없이 화면에 바로 반영된다(HMR). 코드를 고치는 동안에는 이쪽을 쓴다. `1_미리보기실행.bat` 과 같은 실행기에 `PREVIEW_MODE=dev` 를 준 것이다.
- 문제가 생기면 `도구_환경점검.bat` 으로 원인을 먼저 점검하고, 로그가 필요하면 `도구_상세진단.bat` 을 쓴다.
- 그 밖의 도구: `도구_설치복구.bat`(node_modules 복구), `도구_미리보기복구.bat`(`.next` 잠김 복구), `도구_미리보기초기화.bat`(미리보기 `.pglite`+`.next` 삭제 후 시드 재생성), `도구_DB초기화.bat`, `도구_테스트실행.bat`.
- 공통 의존성 점검기는 `tools/ensure-deps.bat` 이다. 각 배치 파일이 `call` 로 부르므로 이름과 위치를 바꾸지 않는다.
- `.env` 에 `NODE_ENV` 를 넣지 않는다. 빌드/실행 모드가 뒤섞여 React 오류가 난다.
- `src/app/error.tsx` 등 에러 바운더리에서 훅(useEffect 등)을 쓰지 않는다. `/_global-error` 프리렌더가 실패한다.
- 서비스 포트는 **3030** 로 고정한다. 변경 시 package.json 의 dev/start, .env 의 PORT·APP_BASE_URL, 배치 파일을 함께 수정한다.

## 마이그레이션 주의

- 마이그레이션은 `prisma/migrations/` 에 시간순으로 쌓여 있다(최초 두 개는 `init_tornado` + `guards_and_indexes`). 폴더명·SQL 은 적용 이력이므로 이미 올라간 것을 고치지 않는다. 순서에 의존하는 DROP 문도 넣지 말 것.
- 스키마를 바꾼 뒤에는 반드시 **빈 DB 에서 `npm run db:reset`** 으로 처음부터 적용되는지 확인한다.
- `prisma migrate reset` 대신 `npm run db:reset`(tools/db-reset.mjs)을 사용한다.

## 자주 쓰는 명령

```bash
npm run preview      # 내장 DB(PGlite)로 미리보기 (설치 불필요)
npm run dev          # 개발 서버 (외부 PostgreSQL 필요)
npm run build        # 프로덕션 빌드
npm run typecheck    # tsc --noEmit
npm test             # Vitest (DB 를 비우므로 실행 후 db:seed 필요)
npm run db:migrate   # prisma migrate dev
npm run db:seed      # 시드 데이터
npm run db:reset     # 초기화 + 시드
npm run check:db     # DB 연결 점검
```

## 공용 파일 수정 시 주의

`src/components/ui/index.tsx`, `src/lib/**`, `src/server/**`, `src/app/globals.css`, `prisma/schema.prisma` 는 전 화면이 공유한다. 변경 시 `npm run typecheck && npm test && npm run build` 를 모두 통과시킨다.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
