import { env } from '@/lib/env';
import type { AdapterInfo, ProviderResult } from '../types';
import { decideMessageType, type MtAdapter, type MtSendRequest, type MtSendResult } from './index';

/**
 * CoolSMS(SOLAPI) MT 발송 어댑터 — **껍데기(미연동)**.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 계약 전 상태에서 "연결만 하면 되는" 자리를 미리 만들어 둔 것이다.
 * send() 는 언제나 예외를 던진다. 실제 문자 사업자 계약과 연동규격서 수령 전에는
 * 절대로 성공을 반환하지 않는다 (CLAUDE.md 절대규칙 2).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 연동 시 확인해야 할 것 (규격서 대조 항목)
 *
 *  1) 엔드포인트
 *     POST https://api.coolsms.co.kr/messages/v4/send
 *     Content-Type: application/json
 *
 *  2) 인증 헤더 (HMAC-SHA256)
 *     date      = new Date().toISOString()
 *     salt      = 랜덤 문자열(12~64자)
 *     signature = HMAC-SHA256(key = MT_API_SECRET, message = date + salt) 의 hex
 *     Authorization: HMAC-SHA256 apiKey=<MT_API_KEY>, date=<date>, salt=<salt>, signature=<signature>
 *
 *  3) 요청 본문
 *     {
 *       "message": {
 *         "to":   "01012345678",          // 하이픈 없는 숫자만
 *         "from": "<MT_SENDER_NUMBER>",   // 사전등록(발신번호 등록) 완료된 번호여야 한다
 *         "text": "<본문>",
 *         "type": "SMS" | "LMS"           // 90byte 초과 시 LMS. decideMessageType() 참고
 *       }
 *     }
 *
 *  4) 응답 본문 (성공)
 *     { "messageId": "M4V2...", "statusCode": "2000", "statusMessage": "정상 접수(이통사로 접수 예정)" }
 *     → providerMessageId 는 messageId 를 쓴다.
 *     → statusCode 가 '2000' 계열이 아니면 실패로 처리한다. 임의로 성공 처리하지 않는다.
 *
 *  5) 주의
 *     - 발신번호 사전등록(전기통신사업법)이 끝난 번호만 from 에 넣을 수 있다.
 *     - 접수 성공(2000)은 "이통사 접수"이지 "단말 수신"이 아니다.
 *       최종 수신 결과는 리포트 웹훅으로 따로 받아야 하며, 그 값으로 결제 결과를 바꾸지 않는다
 *       (CLAUDE.md 절대규칙 3 — 발송 실패가 결제 결과를 바꾸지 않는다).
 */

/** 실연동에 필요한데 아직 없는 설정 항목. */
function missingCredentials(): string[] {
  const missing: string[] = [];
  if (!env.mt.apiKey) missing.push('MT_API_KEY');
  if (!env.mt.apiSecret) missing.push('MT_API_SECRET');
  if (!env.mt.senderNumber) missing.push('MT_SENDER_NUMBER');
  return missing;
}

export const coolsmsMtAdapter: MtAdapter = {
  info(): AdapterInfo {
    // 구현 자체가 아직 없으므로 키가 모두 채워져 있어도 live 라고 말하지 않는다.
    return { provider: 'coolsms', mode: 'mock', missingCredentials: missingCredentials() };
  },

  async send(req: MtSendRequest): Promise<ProviderResult<MtSendResult>> {
    // TODO: 업체 API 명세 확인 후 구현
    //   const date = new Date().toISOString();
    //   const salt = randomHex(16);
    //   const signature = createHmac('sha256', env.mt.apiSecret).update(date + salt).digest('hex');
    //   const res = await fetch('https://api.coolsms.co.kr/messages/v4/send', {
    //     method: 'POST',
    //     headers: {
    //       'Content-Type': 'application/json',
    //       Authorization: `HMAC-SHA256 apiKey=${env.mt.apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
    //     },
    //     body: JSON.stringify({
    //       message: {
    //         to: req.to,
    //         from: env.mt.senderNumber,
    //         text: req.text,
    //         type: decideMessageType(req.text, req.forceType),
    //       },
    //     }),
    //   });
    // 규격서 수령 전이라 실제 호출은 하지 않지만, 본문 길이에 따른 SMS/LMS 판정은
    // 연동 시 그대로 쓰는 값이므로 여기서 미리 확정해 둔다.
    const messageType = decideMessageType(req.text, req.forceType);
    void messageType;

    throw new Error(
      'SMS 업체 미연동: CoolSMS(SOLAPI) 어댑터는 아직 구현되지 않았습니다. ' +
        '계약과 연동규격서 확인 후 src/server/adapters/mt/coolsms.ts 를 완성하십시오.' +
        (missingCredentials().length > 0 ? ` (미설정: ${missingCredentials().join(', ')})` : ''),
    );
  },
};
