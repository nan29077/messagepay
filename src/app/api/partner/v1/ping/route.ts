import { prisma } from '@/server/db';
import { authenticatePartner } from '@/server/services/partner-auth';
import { authError, jsonOk } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/partner/v1/ping
 *
 * 연동 초기 점검용. 키가 유효한지, 어느 가맹점에 연결됐는지 확인한다.
 * 서명 없이 Bearer 만으로 호출할 수 있다.
 */
export async function GET(req: Request) {
  const auth = await authenticatePartner(req, '');
  if (!auth.ok) return authError(auth);

  const merchant = await prisma.merchantProfile.findUnique({
    where: { id: auth.merchantId },
    select: { code: true, displayName: true },
  });

  return jsonOk({
    merchantCode: merchant?.code ?? null,
    merchantName: merchant?.displayName ?? null,
    serverTime: new Date().toISOString(),
  });
}
