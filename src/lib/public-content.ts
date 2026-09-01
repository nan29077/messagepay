/** 공개 화면에 다시 노출되면 안 되는 후원 서비스 시절의 콘텐츠인지 판별한다. */
const LEGACY_DONATION_TERMS = /도네이도|토네이도|문자\s*후원|후원자|크리에이터|후원\s*(번호|금액|한도|처리|내역|메시지|샵)/i;

export function isLegacyDonationContent(content: { title: string; body: string }): boolean {
  return LEGACY_DONATION_TERMS.test(`${content.title}\n${content.body}`);
}
