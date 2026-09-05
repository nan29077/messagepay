import type { ApiCategory } from './types';

/**
 * 가맹점 API 문서 레지스트리 — 단일 원천.
 *
 * 화면(`/studio/docs`), 누락 검사 테스트, 앞으로 만들 OpenAPI 문서가 모두 이 배열을 읽는다.
 * 문서용 사본을 따로 두면 반드시 어긋나므로 한 벌만 둔다.
 *
 * 상태 표기 (사용자 결정 2026-09-05)
 *  - LIVE    지금 호출하면 동작한다
 *  - BETA    동작하지만 규격이 바뀔 수 있다
 *  - PLANNED 아직 없다. 규격은 예고다 — 그래도 문서에 미리 공개한다
 */
export const API_CATEGORIES: ApiCategory[] = [
  // =========================================================== 01 시작하기
  {
    slug: 'start',
    order: 1,
    title: '시작하기',
    summary: '연동 순서와 역할 분담. 처음이라면 여기부터.',
    status: 'LIVE',
    intro: [
      '메시지페이 가맹점 API 는 가맹점 서버가 결제 건을 가져가 처리하고 결과를 알려주는 방식으로 시작합니다. 수신 서버를 두지 않아도 연동할 수 있습니다.',
      '연동은 선택입니다. API 를 붙이지 않아도 주문·판매 화면에서 지급 처리와 배송 등록을 모두 할 수 있습니다.',
    ],
    sections: [
      {
        heading: '역할 분담',
        body: [
          '메시지페이가 하는 일 — 이용자에게서 결제를 받고, 결제 결과를 확정하고, 정산합니다. 문자(MO 수신·MT 발송)는 메시지페이가 처리합니다.',
          '가맹점이 하는 일 — 결제된 건을 자기 서비스에 반영합니다. 포인트를 적립하거나, 상품을 발송하거나, 컨텐츠를 지급합니다. 반영이 끝나면 메시지페이에 알려줍니다.',
          '포인트를 발행하는 주체는 가맹점입니다. 메시지페이는 결제와 정산까지만 책임집니다.',
        ],
      },
      {
        heading: '연동 순서',
        body: [
          '1. 판매 설정 → 연동 탭에서 API 키를 발급합니다. 키 원문과 서명 비밀키는 발급 직후 한 번만 표시됩니다.',
          '2. GET /ping 으로 키가 유효한지, 어느 가맹점에 연결됐는지 확인합니다.',
          '3. GET /charges?status=pending 로 아직 처리하지 않은 결제 건을 가져옵니다.',
          '4. 자기 서비스에 반영한 뒤 POST /charges/ack 로 결과를 알립니다. 알린 건은 다음 조회에서 빠집니다.',
          '5. 실물 상품이라면 POST /charges/shipment 로 송장을 등록합니다.',
        ],
      },
      {
        heading: '용어',
        body: [
          '충전(charge) — 이용자가 돈을 내고 가맹 서비스에 반영되는 한 건. 거래번호는 MP 로 시작합니다.',
          'payerRef — 가맹점 전용 이용자 고정 식별자. 휴대폰 번호를 직접 주고받지 않기 위해 씁니다.',
          'MO — 이용자가 보낸 문자(수신). MT — 메시지페이가 보내는 문자(발신).',
        ],
      },
    ],
  },

  // =========================================================== 02 인증·키
  {
    slug: 'auth',
    order: 2,
    title: '인증·키',
    summary: 'API 키 발급, Bearer 인증, HMAC 서명, 허용 IP.',
    status: 'LIVE',
    intro: [
      '모든 요청에는 API 키가 필요합니다. 쓰기 요청에는 HMAC-SHA256 서명이 추가로 필요합니다.',
      'API 키는 판매 설정 → 연동 탭에서 발급합니다. 키 원문과 서명 비밀키는 저장하지 않으므로 발급 직후 한 번만 보여 드립니다. 분실하면 폐기 후 재발급해야 합니다.',
    ],
    sections: [
      {
        heading: '키 종류',
        body: [
          '운영 키(mp_live_) — 실제 결제·실제 문자·정산 대상입니다.',
          '테스트 키(mp_test_) — 샌드박스 전용입니다. 문자가 나가지 않고, 돈이 빠지지 않고, 정산에 잡히지 않습니다. (준비 중)',
          '접두사를 다르게 두는 이유는 운영 키를 테스트 코드에 넣는 사고를 눈으로 걸러내기 위해서입니다.',
        ],
      },
      {
        heading: '공통 헤더',
        body: ['모든 요청에 Authorization 헤더를 넣습니다. 쓰기 요청에는 아래 서명 헤더 3개를 더합니다.'],
        code: {
          label: '헤더',
          text: [
            'Authorization: Bearer {API 키}',
            'Content-Type: application/json',
            '',
            'X-MP-Timestamp: {유닉스 초}',
            'X-MP-Nonce: {요청마다 다른 임의 문자열}',
            'X-MP-Signature: {아래 서명값}',
          ].join('\n'),
        },
      },
      {
        heading: 'HMAC-SHA256 서명',
        body: [
          '서명 대상 문자열은 타임스탬프, 논스, HTTP 메서드, 경로, 바디를 줄바꿈으로 이어 붙인 값입니다. 서명 비밀키로 HMAC-SHA256 을 계산해 16진수 소문자로 보냅니다.',
          '타임스탬프가 서버 시각과 크게 어긋나면 거절됩니다. 서버 시계를 NTP 로 맞춰 주세요.',
        ],
        code: {
          label: 'Node.js',
          text: [
            "const crypto = require('crypto');",
            '',
            'const ts = Math.floor(Date.now() / 1000).toString();',
            "const nonce = crypto.randomBytes(12).toString('hex');",
            'const body = JSON.stringify(payload);',
            "const base = [ts, nonce, 'POST', '/api/partner/v1/charges/ack', body].join('\\n');",
            "const signature = crypto.createHmac('sha256', signingSecret).update(base).digest('hex');",
          ].join('\n'),
        },
      },
      {
        heading: '허용 IP',
        body: [
          '키를 발급할 때 호출을 허용할 IP 를 지정할 수 있습니다. 비워 두면 어디서나 호출할 수 있습니다.',
          '운영 키에는 IP 를 지정하시길 권합니다. 키가 유출돼도 다른 곳에서는 쓸 수 없습니다.',
        ],
      },
    ],
    endpoints: [
      {
        method: 'GET',
        path: '/ping',
        summary: '연결 점검',
        status: 'LIVE',
        signed: false,
        description: '키가 유효한지, 어느 가맹점에 연결됐는지 확인합니다. 서명 없이 Bearer 만으로 호출할 수 있어 연동 첫 단계에 씁니다.',
        responseExample: '{\n  "ok": true,\n  "data": { "merchantCode": "MSG-8K2M", "merchantName": "바람소리" }\n}',
      },
      {
        method: 'GET',
        path: '/me',
        summary: '가맹점 정보 조회',
        status: 'PLANNED',
        signed: false,
        description: '가맹점 프로필, 결제 모드, 배정된 수신번호, 결제 한도를 한 번에 조회합니다.',
      },
      {
        method: 'GET',
        path: '/keys',
        summary: '발급된 키 목록',
        status: 'PLANNED',
        signed: false,
        description: '키 원문은 포함하지 않습니다. 접두사·이름·마지막 사용 시각·폐기 여부만 돌려줍니다.',
      },
      {
        method: 'POST',
        path: '/keys/rotate',
        summary: '키 무중단 교체',
        status: 'PLANNED',
        signed: true,
        description: '새 키를 발급하고 기존 키에 유예 기간을 둡니다. 배포 중에 인증이 끊기지 않게 합니다.',
        notes: ['유예 기간 동안은 두 키가 모두 동작합니다. 유예가 끝나면 구키는 자동 폐기됩니다.'],
      },
      {
        method: 'DELETE',
        path: '/keys/{prefix}',
        summary: '키 폐기',
        status: 'PLANNED',
        signed: true,
        params: [{ name: 'prefix', in: 'path', type: 'string', required: true, description: '폐기할 키의 접두사' }],
      },
    ],
  },

  // =========================================================== 03 샌드박스
  {
    slug: 'sandbox',
    order: 3,
    title: '샌드박스(테스트)',
    summary: '테스트 키로 실제 영향 없이 전체 흐름을 시험합니다.',
    status: 'PLANNED',
    intro: [
      '테스트 키로 하는 모든 호출은 실제 세계에 아무 영향이 없습니다. 문자가 나가지 않고, 돈이 빠지지 않고, 정산에 잡히지 않습니다.',
      '샌드박스가 없으면 가맹점은 운영 키로 시험하게 됩니다. 그러면 실제 문자가 나가고 실제 결제가 잡힙니다. 그래서 테스트 키를 따로 둡니다.',
    ],
    sections: [
      {
        heading: '테스트 데이터의 경계',
        body: [
          '테스트 키로 만든 결제·주문·문자는 테스트 데이터로 표시되어 운영 통계, 정산, 결제 한도 집계에서 모두 제외됩니다.',
          '가맹점 콘솔에서도 테스트 건은 별도 표시로 구분되며, 원할 때 한 번에 초기화할 수 있습니다.',
        ],
      },
      {
        heading: '시험해 볼 수 있는 흐름',
        body: [
          '이용자가 문자를 보낸 상황을 만들고(모의 MO 주입) → 결제 성공 또는 실패로 확정하고 → 그때 나갔을 문자 전문을 발송함에서 확인하고 → 가맹점 서버가 받을 웹훅을 임의로 발사해 봅니다.',
        ],
      },
    ],
    endpoints: [
      {
        method: 'POST',
        path: '/sandbox/mo',
        summary: '모의 MO 주입',
        status: 'PLANNED',
        signed: true,
        sandboxOnly: true,
        description: '이용자가 수신번호로 문자를 보낸 것처럼 만듭니다. 실제 통신망을 거치지 않습니다.',
        params: [
          { name: 'from', in: 'body', type: 'string', required: true, description: '보낸 사람 휴대폰 번호(테스트용 가상 번호)' },
          { name: 'text', in: 'body', type: 'string', required: true, description: '문자 본문' },
        ],
      },
      {
        method: 'POST',
        path: '/sandbox/charges/{transactionNo}/succeed',
        summary: '모의 결제 성공',
        status: 'PLANNED',
        signed: true,
        sandboxOnly: true,
        description: '결제사 승인이 난 것처럼 결제를 성공으로 확정합니다.',
      },
      {
        method: 'POST',
        path: '/sandbox/charges/{transactionNo}/fail',
        summary: '모의 결제 실패',
        status: 'PLANNED',
        signed: true,
        sandboxOnly: true,
        description: '사유를 지정해 실패로 확정합니다. 실패 분기 처리를 시험할 때 씁니다.',
      },
      {
        method: 'GET',
        path: '/sandbox/outbox',
        summary: '모의 발송함',
        status: 'PLANNED',
        signed: false,
        sandboxOnly: true,
        description: '테스트 중 나갔을 문자 전문을 확인합니다. 실제로는 발송되지 않습니다.',
      },
      {
        method: 'POST',
        path: '/sandbox/webhooks/fire',
        summary: '웹훅 임의 발사',
        status: 'PLANNED',
        signed: true,
        sandboxOnly: true,
        description: '원하는 이벤트를 골라 등록된 수신 URL 로 보냅니다. 수신 처리와 서명 검증을 시험합니다.',
      },
      {
        method: 'POST',
        path: '/sandbox/reset',
        summary: '테스트 데이터 초기화',
        status: 'PLANNED',
        signed: true,
        sandboxOnly: true,
        notes: ['운영 데이터는 지워지지 않습니다. 테스트 키로 만든 데이터만 지웁니다.'],
      },
    ],
  },

  // =========================================================== 04 결제·충전
  {
    slug: 'charges',
    order: 4,
    title: '결제·충전',
    summary: '결제 완료 건을 가져가 처리하고 결과를 알립니다.',
    status: 'LIVE',
    intro: [
      '가장 먼저 붙이는 연동입니다. 결제가 완료된 건을 오래된 순으로 가져가 자기 서비스에 반영한 뒤, 처리했다고 알려주면 다음 조회에서 빠집니다.',
      '이용자 식별은 마스킹된 휴대폰 번호 또는 가맹점 전용 고정 식별자(payerRef)로 합니다. 원문 번호는 내려가지 않습니다.',
    ],
    sections: [
      {
        heading: '금액과 포인트',
        body: ['금액은 원 단위 정수입니다. 소수점이 없습니다. 포인트 환산은 가맹점이 정합니다(기본 안내는 1원 = 1포인트).'],
      },
      {
        heading: '중복 처리 방지',
        body: [
          'ack 는 멱등입니다. 같은 거래번호를 여러 번 보내도 결과가 같습니다.',
          '이미 SENT 인 건은 다시 바뀌지 않습니다. 되돌려야 하면 메시지페이 관리자에게 문의해 주세요.',
        ],
      },
    ],
    endpoints: [
      {
        method: 'GET',
        path: '/charges',
        summary: '결제 완료 건 조회',
        status: 'LIVE',
        signed: false,
        description: '결제가 완료된 충전 건을 오래된 순으로 내려줍니다. 처리하지 않은 건만 받으려면 status=pending 을 씁니다.',
        params: [
          { name: 'status', in: 'query', type: 'string', description: 'pending(기본) | all', example: 'pending' },
          { name: 'since', in: 'query', type: 'ISO8601', description: '이 시각 이후 결제 건만' },
          { name: 'limit', in: 'query', type: 'number', description: '1~500 (기본 100)', example: '100' },
          { name: 'cursor', in: 'query', type: 'string', description: '직전 응답의 nextCursor' },
        ],
        responseExample:
          '{\n  "ok": true,\n  "data": [\n    {\n      "transactionNo": "MP...",\n      "amount": 10000,\n      "message": "응원합니다",\n      "payerRef": "...",\n      "payerPhoneMasked": "010-****-5678",\n      "paidAt": "2026-09-05T12:34:56+09:00",\n      "product": { "name": "포인트 10,000", "kind": "DIGITAL" }\n    }\n  ],\n  "nextCursor": null\n}',
      },
      {
        method: 'POST',
        path: '/charges/ack',
        summary: '처리 결과 통보',
        status: 'LIVE',
        signed: true,
        description: '포인트 적립을 끝냈다고(또는 보류했다고) 알립니다. 알린 건은 다음 pending 조회에서 빠집니다.',
        params: [
          { name: 'transactionNos', in: 'body', type: 'string[]', required: true, description: '처리한 거래번호 목록' },
          { name: 'status', in: 'body', type: 'string', required: true, description: 'SENT | FAILED' },
          { name: 'note', in: 'body', type: 'string', description: '보류·실패 사유' },
        ],
        notes: ['멱등입니다. 같은 건을 여러 번 보내도 결과가 같습니다.'],
      },
      {
        method: 'GET',
        path: '/charges/{transactionNo}',
        summary: '결제 건 단건 조회',
        status: 'PLANNED',
        signed: false,
        description: '거래번호 하나의 상세를 조회합니다. 목록을 다시 훑지 않고 특정 건만 확인할 때 씁니다.',
      },
      {
        method: 'POST',
        path: '/charges/refund',
        summary: '환불 요청',
        status: 'PLANNED',
        signed: true,
        description: '가맹점이 환불을 요청합니다. 승인과 실제 환불 처리는 메시지페이가 합니다.',
      },
      {
        method: 'GET',
        path: '/charges/export',
        summary: '기간 내역 CSV',
        status: 'PLANNED',
        signed: false,
        description: '기간을 지정해 결제 내역을 CSV 로 내려받습니다.',
      },
      {
        method: 'POST',
        path: '/charges/link',
        summary: '결제 링크 발급',
        status: 'PLANNED',
        signed: true,
        description: '가맹점이 자기 사이트에서 결제 링크를 직접 만들어 이용자에게 보여 줍니다. 문자를 거치지 않는 웹 결제 경로입니다.',
      },
    ],
  },

  // =========================================================== 05 상품·재고
  {
    slug: 'products',
    order: 5,
    title: '상품·재고',
    summary: '가맹점 사이트의 상품을 메시지페이와 맞춥니다.',
    status: 'PLANNED',
    intro: [
      '지금은 가맹점 사이트에 있는 상품을 메시지페이 콘솔에 한 번 더 등록해야 합니다. 이 API 는 그 이중 등록을 없앱니다.',
      '실물 상품, 비실물 상품(포인트·상품권·이용권·컨텐츠) 모두 다룹니다. 옵션과 옵션가도 함께 맞춥니다.',
    ],
    endpoints: [
      { method: 'GET', path: '/products', summary: '상품 목록', status: 'PLANNED', signed: false },
      { method: 'POST', path: '/products', summary: '상품 등록', status: 'PLANNED', signed: true, description: '실물 / 비실물(포인트·상품권·이용권·컨텐츠)을 등록합니다.' },
      { method: 'PATCH', path: '/products/{id}', summary: '상품 수정', status: 'PLANNED', signed: true },
      { method: 'PATCH', path: '/products/{id}/stock', summary: '재고·품절 갱신', status: 'PLANNED', signed: true, notes: ['재고 0 이면 문자 안내에서 해당 상품이 빠집니다.'] },
      { method: 'POST', path: '/products/bulk', summary: '일괄 등록·동기화', status: 'PLANNED', signed: true, description: '가맹점 사이트의 상품 목록을 통째로 보내 맞춥니다.' },
      { method: 'GET', path: '/products/{id}/options', summary: '옵션·옵션가 조회', status: 'PLANNED', signed: false },
    ],
  },

  // =========================================================== 06 주문·배송
  {
    slug: 'orders',
    order: 6,
    title: '주문·배송',
    summary: '실물 주문의 송장 등록과 반품·교환 처리.',
    status: 'LIVE',
    intro: [
      '실물 상품을 파는 가맹점만 필요한 연동입니다. 자기 물류 시스템에서 출고한 결과를 메시지페이에 올려 이용자가 조회할 수 있게 합니다.',
      '송장 없이 발송 처리하면 이용자가 배송을 조회할 수 없고, 분쟁이 났을 때 발송 사실을 증명하지 못합니다. 그래서 SHIPPED 로 바꾸려면 택배사와 송장번호가 반드시 있어야 합니다.',
    ],
    endpoints: [
      {
        method: 'POST',
        path: '/charges/shipment',
        summary: '배송 상태·송장 등록',
        status: 'LIVE',
        signed: true,
        params: [
          { name: 'transactionNo', in: 'body', type: 'string', required: true, description: '거래번호' },
          { name: 'status', in: 'body', type: 'string', required: true, description: 'PREPARING | SHIPPED | DELIVERED 등' },
          { name: 'carrier', in: 'body', type: 'string', description: '택배사 (SHIPPED 시 필수)' },
          { name: 'trackingNo', in: 'body', type: 'string', description: '송장번호 (SHIPPED 시 필수)' },
        ],
        notes: [
          '멱등입니다. 같은 값을 다시 보내도 결과가 같습니다.',
          'SHIPPED 로 바꾸면 이용자에게 발송 안내 문자가 자동으로 나갑니다.',
        ],
      },
      { method: 'GET', path: '/orders', summary: '주문 목록', status: 'PLANNED', signed: false },
      { method: 'GET', path: '/orders/{orderNo}', summary: '주문 상세', status: 'PLANNED', signed: false, notes: ['배송지 원문 열람은 감사 로그에 남습니다.'] },
      { method: 'POST', path: '/orders/{orderNo}/return', summary: '반품 접수·상태 갱신', status: 'PLANNED', signed: true },
      { method: 'POST', path: '/orders/{orderNo}/exchange', summary: '교환 접수·재발송', status: 'PLANNED', signed: true },
      { method: 'GET', path: '/carriers', summary: '택배사 코드표', status: 'PLANNED', signed: false },
    ],
  },

  // =========================================================== 07 이용자 연결
  {
    slug: 'payers',
    order: 7,
    title: '이용자 연결',
    summary: '가맹점 회원과 메시지페이 이용자를 잇습니다.',
    status: 'PLANNED',
    intro: [
      '가맹점 회원과 메시지페이 이용자를 잇는 연동입니다. 휴대폰 번호를 그대로 주고받지 않고 payerRef 라는 가맹점 전용 고정 식별자로 다룹니다.',
      '같은 이용자라도 가맹점마다 payerRef 가 다릅니다. 가맹점끼리 이용자를 대조할 수 없게 만든 설계입니다.',
    ],
    endpoints: [
      { method: 'GET', path: '/payers/{payerRef}', summary: '이용자 요약', status: 'PLANNED', signed: false, description: '마스킹 번호, 누적 결제 금액, 최근 결제일.' },
      { method: 'POST', path: '/payers/link', summary: '회원 매핑 등록', status: 'PLANNED', signed: true, description: '가맹점 회원 ID 와 payerRef 를 연결합니다.' },
      { method: 'GET', path: '/payers/{payerRef}/charges', summary: '이용자별 결제 이력', status: 'PLANNED', signed: false },
      { method: 'DELETE', path: '/payers/link/{payerRef}', summary: '연결 해제', status: 'PLANNED', signed: true },
    ],
  },

  // =========================================================== 08 MO 수신
  {
    slug: 'mo',
    order: 8,
    title: 'MO 수신',
    summary: '이용자가 보낸 문자를 가맹점 사이트로 가져갑니다.',
    status: 'PLANNED',
    intro: [
      '이용자가 가맹점 수신번호로 보낸 문자를 가맹점 서버가 받아 볼 수 있게 하는 연동입니다.',
      '두 가지 방식을 함께 제공합니다. 수신 서버가 있으면 웹훅(실시간)을, 없으면 조회(주기적으로 가져가기)를 쓰시면 됩니다.',
    ],
    sections: [
      {
        heading: '수신번호 체계',
        body: [
          '가맹점마다 고유한 수신번호가 배정됩니다. 이용자가 그 번호로 문자를 보내면 어느 가맹점인지 번호만으로 구분됩니다.',
          '대표번호를 여러 가맹점이 함께 쓰는 경우에는 문자 맨 앞의 키워드로 구분합니다.',
        ],
      },
    ],
    endpoints: [
      { method: 'GET', path: '/mo/messages', summary: '수신 문자 조회', status: 'PLANNED', signed: false, description: '커서 페이징으로 수신 문자를 가져갑니다. 수신 서버가 없을 때 쓰는 방식입니다.' },
      { method: 'GET', path: '/mo/messages/{id}', summary: '수신 문자 단건', status: 'PLANNED', signed: false },
      { method: 'GET', path: '/mo/numbers', summary: '내 수신번호 조회', status: 'PLANNED', signed: false, description: '배정된 수신번호와 상태, 키워드를 확인합니다.' },
      { method: 'POST', path: '/mo/keywords', summary: '키워드 라우팅 등록', status: 'PLANNED', signed: true },
    ],
  },

  // =========================================================== 09 MT 발송
  {
    slug: 'mt',
    order: 9,
    title: 'MT 발송',
    summary: '가맹점이 이용자에게 거래 안내 문자를 보냅니다.',
    status: 'PLANNED',
    intro: [
      '가맹점이 자기 이용자에게 문자를 보내는 연동입니다. 처음 여는 v1 은 범위를 좁게 잡았습니다.',
      '범위를 좁힌 이유는 규제 때문입니다. 아래 네 가지 제약이 있으면 광고성 정보에 붙는 사전 동의, 야간 발송 제한, 수신거부 문구 의무가 적용 대상이 아니게 됩니다. 그래서 가맹점이 준비할 것이 거의 없습니다.',
    ],
    sections: [
      {
        heading: 'v1 의 네 가지 제약',
        body: [
          '1. 발신번호는 메시지페이 번호로 고정됩니다. 가맹점이 발신번호를 따로 등록하지 않아도 됩니다.',
          '2. 정보성 문자만 보낼 수 있습니다. 거래·주문·지급과 직접 관련된 안내여야 하며 광고·홍보 문구는 보낼 수 없습니다.',
          '3. 수신자는 그 가맹점에 거래 이력이 있는 이용자만 지정할 수 있습니다. payerRef 로만 지정하며 임의의 번호를 넣을 수 없습니다.',
          '4. 미리 등록해 검수받은 템플릿과 치환자만 쓸 수 있습니다. 자유 본문은 보낼 수 없습니다.',
        ],
      },
      {
        heading: 'v2 로 미루는 것',
        body: [
          '가맹점 발신번호 등록, 자유 본문, 광고성 발송, 대량 캠페인, 예약 발송, 카카오 알림톡 대체발송은 별도 계약과 심사가 필요합니다. 준비되는 대로 이 문서에 추가됩니다.',
        ],
      },
    ],
    endpoints: [
      {
        method: 'POST',
        path: '/mt/messages',
        summary: '문자 1건 발송',
        status: 'PLANNED',
        signed: true,
        description: '등록된 템플릿과 치환값으로 문자를 보냅니다.',
        params: [
          { name: 'templateCode', in: 'body', type: 'string', required: true, description: '검수 통과한 템플릿 코드' },
          { name: 'payerRef', in: 'body', type: 'string', required: true, description: '수신자. 거래 이력이 있는 이용자만' },
          { name: 'variables', in: 'body', type: 'object', description: '템플릿 치환값' },
          { name: 'Idempotency-Key', in: 'header', type: 'string', required: true, description: '중복 발송 방지' },
        ],
        notes: ['멱등키가 없으면 거절됩니다. 재시도로 같은 문자가 두 번 나가는 사고를 막기 위해서입니다.'],
      },
      { method: 'GET', path: '/mt/messages/{id}', summary: '발송 상태 조회', status: 'PLANNED', signed: false, description: '접수 / 발송 / 도달 / 실패와 실패 사유.' },
      { method: 'GET', path: '/mt/messages', summary: '발송 이력 목록', status: 'PLANNED', signed: false },
      { method: 'GET', path: '/mt/templates', summary: '템플릿 목록', status: 'PLANNED', signed: false, description: '등록된 템플릿과 쓸 수 있는 치환자.' },
      { method: 'POST', path: '/mt/templates', summary: '템플릿 등록·검수 신청', status: 'PLANNED', signed: true, notes: ['검수는 등록 시점에 한 번만 합니다. 통과한 템플릿은 발송 때 다시 검수하지 않습니다.'] },
      { method: 'GET', path: '/mt/quota', summary: '남은 발송 한도', status: 'PLANNED', signed: false },
    ],
  },

  // =========================================================== 10 웹훅
  {
    slug: 'webhooks',
    order: 10,
    title: '웹훅(이벤트 구독)',
    summary: '메시지페이에서 일어난 일을 실시간으로 받습니다.',
    status: 'PLANNED',
    intro: [
      '주기적으로 가져가는 대신, 일이 생긴 순간 가맹점 서버로 밀어 주는 방식입니다. 수신 URL 을 등록하고 받을 이벤트를 고르면 됩니다.',
      '웹훅은 중복해서 도착할 수 있습니다. 네트워크가 끊기면 재전송하기 때문입니다. 받는 쪽에서 이벤트 ID 로 중복을 걸러 주세요.',
    ],
    sections: [
      {
        heading: '이벤트 목록',
        body: [
          'mo.received — 이용자가 문자를 보냈습니다.',
          'charge.succeeded / charge.failed / charge.refunded — 결제가 성공·실패·환불되었습니다.',
          'mt.delivered / mt.failed — 보낸 문자가 도달·실패했습니다.',
          'shipment.updated — 배송 상태가 바뀌었습니다.',
          'settlement.paid — 정산금이 지급되었습니다.',
          'product.stock_low — 재고가 기준 아래로 떨어졌습니다.',
          'payer.linked — 이용자 연결이 만들어졌습니다.',
        ],
      },
      {
        heading: '서명 검증',
        body: [
          '모든 웹훅에는 서명 헤더가 붙습니다. 받는 쪽에서 반드시 검증해 주세요. 검증하지 않으면 누구나 가짜 이벤트를 보낼 수 있습니다.',
          '검증 방법은 요청 본문 원문과 타임스탬프를 이어 붙여 HMAC-SHA256 을 계산해 헤더 값과 비교하는 방식입니다. 요청 본문을 파싱하기 전에 원문 그대로 검증해야 합니다.',
        ],
      },
      {
        heading: '재시도',
        body: [
          '2xx 응답이 아니면 간격을 늘려 가며 여러 번 재시도합니다. 재시도가 모두 실패하면 전송 이력에 남고, 나중에 수동으로 재전송할 수 있습니다.',
          '수신 처리가 오래 걸리면 먼저 200 을 돌려주고 뒤에서 처리해 주세요. 응답이 느리면 타임아웃으로 재시도가 쌓입니다.',
        ],
      },
    ],
    endpoints: [
      { method: 'POST', path: '/webhooks', summary: '수신 URL 등록', status: 'PLANNED', signed: true },
      { method: 'GET', path: '/webhooks', summary: '등록된 엔드포인트 목록', status: 'PLANNED', signed: false },
      { method: 'DELETE', path: '/webhooks/{id}', summary: '등록 해제', status: 'PLANNED', signed: true },
      { method: 'POST', path: '/webhooks/{id}/test', summary: '테스트 이벤트 발사', status: 'PLANNED', signed: true },
      { method: 'GET', path: '/webhooks/deliveries', summary: '전송 이력·실패 사유', status: 'PLANNED', signed: false },
      { method: 'POST', path: '/webhooks/deliveries/{id}/retry', summary: '실패 건 재전송', status: 'PLANNED', signed: true },
    ],
  },

  // =========================================================== 11 정산·수수료
  {
    slug: 'settlements',
    order: 11,
    title: '정산·수수료',
    summary: '정산 회차와 명세, 적용 수수료율.',
    status: 'PLANNED',
    intro: [
      '가맹점 회계 시스템에 정산 내역을 자동으로 넣기 위한 연동입니다.',
      '정산 기준일과 지급 일정은 콘솔의 정산 관리 화면과 같습니다. 이 API 는 같은 값을 기계가 읽을 수 있게 내려줍니다.',
    ],
    endpoints: [
      { method: 'GET', path: '/settlements', summary: '정산 회차 목록', status: 'PLANNED', signed: false },
      { method: 'GET', path: '/settlements/{id}', summary: '회차 상세', status: 'PLANNED', signed: false, description: '건별 내역, 수수료, 원천징수, 실지급액.' },
      { method: 'GET', path: '/settlements/{id}/export', summary: '정산 명세 CSV', status: 'PLANNED', signed: false },
      { method: 'GET', path: '/fees', summary: '적용 수수료율', status: 'PLANNED', signed: false, description: '수수료율과 부가세 처리 방식.' },
    ],
  },

  // =========================================================== 12 리포트·통계
  {
    slug: 'stats',
    order: 12,
    title: '리포트·통계',
    summary: '일별·상품별·문자 집계.',
    status: 'PLANNED',
    intro: ['가맹점 자체 대시보드에 메시지페이 지표를 함께 띄우기 위한 연동입니다. 집계된 값만 내려주므로 개인정보가 포함되지 않습니다.'],
    endpoints: [
      { method: 'GET', path: '/stats/daily', summary: '일별 집계', status: 'PLANNED', signed: false, description: '결제 건수·금액·실패 건수.' },
      { method: 'GET', path: '/stats/products', summary: '상품별 집계', status: 'PLANNED', signed: false },
      { method: 'GET', path: '/stats/messages', summary: '문자 집계', status: 'PLANNED', signed: false, description: 'MO 수신·MT 발송 건수.' },
    ],
  },

  // =========================================================== 13 로드맵
  {
    slug: 'roadmap',
    order: 13,
    title: '로드맵',
    summary: '앞으로 열릴 연동 영역. 전부 준비 중입니다.',
    status: 'PLANNED',
    intro: [
      '구상 단계인 영역까지 미리 공개합니다. 가맹점이 중장기 계획을 세울 수 있게 하기 위해서입니다.',
      '아래 항목은 규격이 확정되지 않았습니다. 순서와 내용이 바뀔 수 있습니다.',
    ],
    sections: [
      {
        heading: '문서·전자계약',
        body: ['계약서나 문서를 이용자에게 문자로 전달하는 연동입니다. 파일을 문자에 싣지 않고 일회용 보안링크와 본인확인을 거치는 방식으로 설계 중입니다.'],
      },
      {
        heading: '파트너·리셀러',
        body: ['문서인증 서비스처럼 자기 가맹점을 여럿 거느린 사업자가, 메시지페이에서 받은 수신번호를 자기 가맹점들에게 나눠 주는 구조입니다.'],
      },
      {
        heading: '그 밖에 검토 중',
        body: [
          '정기결제·구독 — 문자로 시작하는 정기 충전',
          '카카오 알림톡 대체발송 — 문자 실패 시 폴백',
          '본인확인·인증번호 발송 API',
          '쿠폰·프로모션 코드 발급과 소진',
          '해외 번호 MO/MT',
          '가맹점 사이트에 넣는 결제 현황 위젯',
        ],
      },
    ],
    endpoints: [
      { method: 'POST', path: '/documents/send', summary: '문서 전달', status: 'PLANNED', signed: true, description: '계약서·문서를 이용자에게 일회용 보안링크로 보냅니다.' },
      { method: 'GET', path: '/documents/{id}', summary: '문서 열람·서명 상태', status: 'PLANNED', signed: false },
      { method: 'POST', path: '/documents/{id}/revoke', summary: '문서 링크 회수', status: 'PLANNED', signed: true },
      { method: 'POST', path: '/numbers/issue', summary: '하위 가맹점 번호 발급', status: 'PLANNED', signed: true },
      { method: 'DELETE', path: '/numbers/{phoneNumber}', summary: '번호 회수', status: 'PLANNED', signed: true, notes: ['회수한 번호는 냉각기간이 지나기 전에는 다시 배정되지 않습니다.'] },
      { method: 'GET', path: '/submerchants', summary: '하위 가맹점 목록', status: 'PLANNED', signed: false },
      { method: 'POST', path: '/submerchants', summary: '하위 가맹점 등록', status: 'PLANNED', signed: true },
    ],
  },

  // =========================================================== 14 공통 규약
  {
    slug: 'common',
    order: 14,
    title: '공통 규약',
    summary: '응답 형식, 오류 코드, 멱등성, 개인정보, 변경 이력.',
    status: 'LIVE',
    intro: ['모든 엔드포인트에 공통으로 적용되는 규칙입니다. 개별 문서에서 따로 설명하지 않습니다.'],
    sections: [
      {
        heading: '기본 URL',
        body: ['https://{서비스 도메인}/api/partner/v1'],
      },
      {
        heading: '응답 형식',
        body: ['성공과 실패 모두 같은 껍데기를 씁니다. HTTP 상태 코드만 보고 판단하지 말고 ok 값을 확인해 주세요.'],
        code: {
          label: '응답',
          text: [
            '{',
            '  "ok": true,',
            '  "data": { },',
            '  "nextCursor": null',
            '}',
            '',
            '{',
            '  "ok": false,',
            '  "error": { "code": "INVALID_SIGNATURE", "message": "서명이 올바르지 않습니다." }',
            '}',
          ].join('\n'),
        },
      },
      {
        heading: '멱등성',
        body: [
          '쓰기 요청에는 Idempotency-Key 헤더를 넣어 주세요. 같은 키로 다시 보내면 처음 결과를 그대로 돌려줍니다.',
          '네트워크가 끊겨 재시도할 때 같은 작업이 두 번 일어나는 것을 막습니다. 결제·발송처럼 되돌리기 어려운 작업에서 특히 중요합니다.',
        ],
      },
      {
        heading: '페이지네이션',
        body: ['커서 방식입니다. 응답의 nextCursor 를 다음 요청의 cursor 로 넘기면 됩니다. nextCursor 가 null 이면 마지막 페이지입니다.'],
      },
      {
        heading: '시간과 금액',
        body: [
          '모든 시각은 ISO8601 이며 KST(UTC+9) 기준입니다.',
          '모든 금액은 원 단위 정수입니다. 소수점이 없습니다.',
        ],
      },
      {
        heading: '개인정보',
        body: [
          '휴대폰 번호는 마스킹된 형태 또는 payerRef 로만 내려갑니다. 원문 번호는 API 로 나가지 않습니다.',
          '배송지 주소처럼 민감한 값은 열람 시 감사 로그가 남습니다.',
          '받은 개인정보는 목적 범위 안에서만 쓰고, 보관 기간이 지나면 파기해 주세요.',
        ],
      },
      {
        heading: '버전 정책',
        body: [
          '하위호환을 깨지 않는 변경은 v1 안에서 이뤄집니다. 필드가 늘어날 수 있으니 모르는 필드는 무시하도록 구현해 주세요.',
          '하위호환이 깨지는 변경은 v2 로 나갑니다. 기존 버전은 최소 6개월 예고 후 종료합니다.',
        ],
      },
      {
        heading: '변경 이력',
        body: [
          '2026-09-05 — 문서 허브 개설. 준비 중 API 를 미리 공개하기 시작했습니다.',
        ],
      },
    ],
  },

  // =========================================================== 15 개발자 도구
  {
    slug: 'tools',
    order: 15,
    title: '개발자 도구',
    summary: 'OpenAPI, Postman, 예제 코드.',
    status: 'PLANNED',
    intro: ['문서를 읽는 것보다 바로 호출해 보는 편이 빠릅니다. 아래 도구를 준비하고 있습니다.'],
    sections: [
      {
        heading: '준비 중인 도구',
        body: [
          'OpenAPI 3.1 규격 파일 — Postman 이나 코드 생성기에 바로 넣을 수 있습니다.',
          'Postman 컬렉션 — 키만 넣으면 곧바로 호출됩니다.',
          '예제 코드 — Node.js, PHP, Python. 서명 생성까지 포함합니다.',
          '웹훅 검증 스니펫 — 언어별 서명 검증 코드.',
          '콘솔 내 API 테스터 — 이 화면에서 바로 호출해 응답을 확인합니다.',
        ],
      },
    ],
  },
];

/** slug 로 카테고리를 찾는다. */
export function findCategory(slug: string): ApiCategory | undefined {
  return API_CATEGORIES.find((c) => c.slug === slug);
}

/** 목차 순서대로 정렬된 카테고리. */
export function orderedCategories(): ApiCategory[] {
  return [...API_CATEGORIES].sort((a, b) => a.order - b.order);
}

/** 레지스트리에 등록된 모든 엔드포인트(카테고리 정보 포함). */
export function allEndpoints() {
  return orderedCategories().flatMap((category) =>
    (category.endpoints ?? []).map((endpoint) => ({ category, endpoint })),
  );
}

/** 상태별 엔드포인트 개수. 허브 화면의 요약 숫자에 쓴다. */
export function endpointCounts() {
  const rows = allEndpoints();
  return {
    total: rows.length,
    live: rows.filter((r) => r.endpoint.status === 'LIVE').length,
    beta: rows.filter((r) => r.endpoint.status === 'BETA').length,
    planned: rows.filter((r) => r.endpoint.status === 'PLANNED').length,
  };
}
