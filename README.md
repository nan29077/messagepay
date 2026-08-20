# 도네이도 (DONAIDO)

문자 한 통으로 크리에이터를 후원하는 플랫폼. 시청자가 크리에이터별 MO 수신번호로 문자를 보내면 도네이도가 이를 수신해 후원 거래로 만들고, 결제가 완료된 건만 유튜브 라이브 채팅 · OBS/PRISM 오버레이 · TTS 로 방송에 노출합니다.

> **현재 상태: 1단계 Mock MVP.** 결제(헥토파이낸셜 내통장결제), MO/MT 문자, 유튜브, TTS, RTMPS 는 모두 **어댑터 인터페이스 + mock 구현**입니다. 실제 출금·문자 발송·유튜브 전송은 일어나지 않습니다.

---

## 빠른 시작 (Windows)

### A. 간편 미리보기 — `preview.bat` 하나만 실행 (권장)

**Node.js LTS 만 있으면 됩니다.** Docker 도, PostgreSQL 설치도 필요 없습니다.
내장 데이터베이스(PGlite — PostgreSQL 을 WASM 으로 빌드한 임베디드 엔진)를 사용하며, 실제 PostgreSQL 과 동일한 스키마·마이그레이션·트리거가 그대로 적용됩니다.

| 파일 | 설명 |
|---|---|
| `preview.bat` | 설치 → 내장 DB 기동 → 마이그레이션 → 시드 → 빌드 → 서버 실행 → 브라우저 자동 열기 |
| `preview-reset.bat` | 미리보기 데이터 초기화 (`.pglite` 폴더 삭제) |

주소는 **http://localhost:3025** 입니다. 데이터는 `.pglite` 폴더에 보관되어 다음 실행에도 유지됩니다.

> 첫 실행은 `npm install` 3~7분 + 화면 빌드 1~3분이 걸립니다. 멈춘 것처럼 보여도 정상이며, 두 번째부터는 30초 내외입니다.
> 코드 수정을 즉시 반영하려면 `PREVIEW_MODE=dev` 환경변수를 주고 `npm run preview` 를 실행하세요.
> `EBADENGINE` 경고는 사용하지 않는 부가 패키지 경고이므로 무시해도 됩니다.

### B. 정식 개발 환경 — 실제 PostgreSQL 사용

운영과 동일한 조건으로 개발할 때 사용합니다. Docker Desktop 이 필요합니다.

| 순서 | 파일 | 설명 |
|---|---|---|
| 1 | `db-up.bat` | PostgreSQL + Redis 컨테이너 시작 |
| 2 | `setup.bat` | 의존성 설치 → Prisma 생성 → 마이그레이션 → 시드 |
| 3 | `start.bat` | 개발 서버 실행 + 준비 완료 후 브라우저 자동 열기 |

> Docker 없이 직접 설치한 PostgreSQL 을 쓰셔도 됩니다. `.env` 의 `DATABASE_URL` 만 바꾸고 `setup.bat` 을 실행하세요.
> Redis 는 없어도 동작합니다. 연결에 실패하면 개발 환경에서는 인메모리로 자동 전환됩니다.

### 그 외

| 파일 | 설명 |
|---|---|
| `doctor.bat` | 환경 자동 점검 (Node·Docker·포트·DB 연결) — 문제가 생기면 이것부터 |
| `repair.bat` | 깨진 node_modules 복구 (npm ci + 무결성 검사) |
| `diag.bat` | 상세 진단 로그 생성 (`logs\diag.log`) |
| `start-prod.bat` | 프로덕션 빌드 후 실행 |
| `db-reset.bat` | 정식 개발 환경 DB 초기화 + 시드 |
| `test.bat` | 통합 테스트 27개 실행 후 시드 재생성 |
| `git-push.bat` | GitHub(`nan29077/tornado`)에 커밋·푸시 |

**필요한 사전 설치**: [Node.js LTS](https://nodejs.org) (필수) · [Docker Desktop](https://www.docker.com/products/docker-desktop/) (B 방식만) · [Git](https://git-scm.com) (선택)

## 빠른 시작 (macOS / Linux)

```bash
npm install
cp .env.example .env
docker compose -p tornado up -d   # PostgreSQL + Redis
npm run db:deploy
npm run db:seed
npm run dev                       # http://localhost:3025
```

### 시드 계정

| 구분 | 계정 | 비밀번호 |
|---|---|---|
| 통합 관리자 | `admin@tornado.kr` | `tornado1234!` |
| 크리에이터 | `creator1@tornado.kr` | `tornado1234!` (코드 `TOR-8K2M`, 전용번호 `15881001`) |
| 크리에이터 | `creator2@tornado.kr` | `tornado1234!` (코드 `TOR-3QP7`, 대표번호 `15889000` + 키워드 `TOR3QP7`) |
| 테스트 후원자 | `010-1234-5678` | 계좌 등록 완료 상태 |

---

## 전체 흐름 직접 확인하기

가장 쉬운 방법은 **관리자 → MO 시뮬레이터** (`/admin/simulator`) 입니다.

1. `admin@tornado.kr` 로 로그인 → `/admin/simulator`
2. 수신번호 `15881001`, 발신번호 아무 번호, 문자 내용 입력 후 실행
3. 미등록 번호라면 계좌 등록 안내가 발송됩니다. 로컬에서는 `GET /api/dev/outbox` 로 발송된 문자와 보안링크 원문을 확인할 수 있습니다 (`APP_ENV=local` 에서만 동작).
4. 등록 링크 → 동의 → 모의 결제창에서 계좌 등록
5. 같은 번호로 다시 시뮬레이션 → 확인 링크 → `3,000원 후원하기`
6. 결제 성공 시 `/overlay/{creatorId}?token=...` 에 후원 알림이 뜨고, 정산 원장에 3분개가 쌓입니다.

MO Webhook 을 직접 호출하려면 HMAC 서명이 필요합니다.

```bash
BODY='{"messageId":"MO-1","to":"15881001","from":"01012345678","text":"오늘 방송 재미있어요","type":"SMS"}'
SIG=$(node -e "const c=require('crypto');process.stdout.write(c.createHmac('sha256',process.env.MO_WEBHOOK_SECRET).update(process.argv[1]).digest('hex'))" "$BODY")
curl -X POST http://localhost:3025/api/webhooks/mo \
  -H 'Content-Type: application/json' \
  -H "x-tornado-signature: sha256=$SIG" \
  -d "$BODY"
```

---

## 명령어

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` / `npm start` | 프로덕션 빌드 / 실행 |
| `npm run typecheck` | 타입 검사 |
| `npm test` | 핵심 흐름 통합 테스트 (Vitest, 실제 DB 사용) |
| `npm run db:migrate` | 마이그레이션 생성·적용 (개발) |
| `npm run db:deploy` | 마이그레이션 적용 (배포) |
| `npm run db:seed` | 시드 데이터 |
| `npm run db:reset` | DB 초기화 + 시드 |
| `npm run preview` | 내장 DB(PGlite) 로 미리보기 실행 |
| `npm run check:db` | DB 연결 점검 |

> `npm test` 는 실행 전후로 DB 를 비웁니다. 테스트 후에는 `npm run db:seed` 로 다시 채우세요.

---

## 화면 구조

```
공개        /  /how-it-works  /faq  /notice  /support  /terms  /privacy  /terms/e-finance
            /creator-apply  /login  /signup  /c/{크리에이터코드}
보안링크     /r/{token}                 계좌 등록 · 결제 확인 (1회용, 단기 만료)
후원자       /my                        후원내역 · 결제내역 · 등록계좌 · 한도 · 차단 · 동의이력
크리에이터   /studio                    대시보드 · 후원내역 · 문자관리 · 유튜브 · 오버레이 · TTS
                                       자체방송 · 후원설정 · 금칙어 · 신고 · 정산 · 프로필
통합 관리자  /admin                     23개 메뉴 (회원 · 크리에이터 · MO번호 · 거래 · 환불
                                       한도/이상거래 · 방송 · 정산 · 정책 · 콘텐츠 · 감사로그 · 시뮬레이터)
오버레이     /overlay/{creatorId}?token= OBS/PRISM 브라우저 소스
Mock        /mock/pg/register           헥토 결제창 대체 (실연동 시 제거)
            /mock/youtube/consent       구글 동의화면 대체
```

## API

| 엔드포인트 | 설명 |
|---|---|
| `POST /api/webhooks/mo` | MO 사업자 Webhook (HMAC 서명 + IP 허용 검증) |
| `GET /api/overlay/{creatorId}/stream` | 오버레이 실시간 이벤트 (SSE) |
| `POST /api/auth/login` `POST /api/auth/logout` | 인증 |
| `GET /api/youtube/oauth/callback` | 구글 OAuth 콜백 |
| `GET /api/health` | DB/캐시 상태, provider 모드, 운영 경고 |
| `GET /api/dev/outbox` | **개발 전용** 모의 MT 발송함 (`APP_ENV=local` 에서만) |

---

## 안전 스위치

| 환경변수 | 기본값 | 의미 |
|---|---|---|
| `SAFE_MODE` | `true` | 실제 결제 승인과 실제 MT 발송을 차단하고 mock 으로 대체 |
| `ALLOW_DIRECT_TRIGGER` | `false` | MO 수신 즉시 결제(`DIRECT_TRIGGER`) 허용 여부. 금융사 서면승인 등록 전에는 반드시 `false` |
| `PAYMENT_PROVIDER` 외 | `mock` | 각 외부 연동의 실 사업자 전환 스위치 |

`GET /api/health` 와 `/admin` 대시보드에서 현재 상태를 항상 확인할 수 있습니다.

---

## 문서

| 문서 | 내용 |
|---|---|
| `docs/01_1차_분석_설계_보고서.md` | 사전 분석, 적용 범위, 필요 계약·키, 위험요소, 우선순위 |
| `docs/02_아키텍처.md` | 상태머신, 멱등성 4중 방어, 데이터 모델, 보안 설계 |
| `docs/03_AWS_배포_가이드.md` | RDS/Aurora, ElastiCache, Secrets Manager, 파티셔닝, 체크리스트 |
| `docs/04_1단계_완료보고서.md` | 구현 기능 / 테스트 결과 / Mock 인 기능 / 필요한 계약·키 / 다음 단계 |
| `CLAUDE.md` | 개발 규칙 |
