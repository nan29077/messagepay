'use server';

import { prisma } from '@/server/db';
import { kv } from '@/server/redis';
import { headers } from 'next/headers';
import { normalizeCreatorCode } from '@/lib/id';

/**
 * 크리에이터 코드 조회.
 * 전체 목록을 공개하지 않으므로, 코드 존재 여부를 과도하게 탐색하지 못하도록
 * IP 단위 요청 제한을 적용한다.
 */

const WINDOW_SEC = 60;
const MAX_TRIES = 15;

export interface LookupResult {
  ok: boolean;
  code?: string;
  message?: string;
}

export async function lookupCreatorCode(input: string): Promise<LookupResult> {
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

  const tries = await kv.incr(`lookup:${ip}`, WINDOW_SEC);
  if (tries > MAX_TRIES) {
    return { ok: false, message: '조회 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' };
  }

  const code = normalizeCreatorCode(input);
  if (!/^TOR-[A-Z0-9]{4,8}$/.test(code)) {
    return { ok: false, message: '코드 형식이 올바르지 않습니다. 예: TOR-8K2M' };
  }

  const creator = await prisma.creatorProfile.findFirst({
    where: { code, status: 'APPROVED' },
    select: { code: true },
  });

  if (!creator) {
    return {
      ok: false,
      message: '크리에이터를 찾을 수 없습니다. 방송 화면 또는 크리에이터 프로필에 안내된 코드를 다시 확인해 주세요.',
    };
  }

  return { ok: true, code: creator.code };
}
