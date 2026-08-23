import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { kv } from '@/server/redis';
import { createSession, verifyPassword } from '@/server/auth';
import { isSameOrigin } from '@/server/request-guard';

export const runtime = 'nodejs';

const schema = z.object({
  email: z.string().email('이메일 형식이 올바르지 않습니다.'),
  password: z.string().min(1, '비밀번호를 입력해 주세요.'),
});

export async function POST(req: Request) {
  // CSRF 방어: 외부 사이트에서 강제로 로그인시키는(세션 고정) 공격을 막는다.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, message: '허용되지 않은 요청입니다.' }, { status: 403 });
  }

  // 본문은 한 번만 읽을 수 있으므로 Content-Type 으로 분기한다.
  const contentType = req.headers.get('content-type') ?? '';
  const isForm = contentType.includes('form-data') || contentType.includes('x-www-form-urlencoded');

  let payload: { email?: string; password?: string } = {};
  let nextPath: string | null = null;
  if (isForm) {
    const form = await req.formData().catch(() => null);
    payload = {
      email: String(form?.get('email') ?? ''),
      password: String(form?.get('password') ?? ''),
    };
    nextPath = safeNextPath(form?.get('next'));
  } else {
    payload = (await req.json().catch(() => ({}))) as typeof payload;
  }

  // HTML 폼 제출은 JSON 대신 로그인 화면으로 되돌려 오류를 안내한다.
  // (로그인 페이지의 ERROR_MESSAGES 키와 맞춘다: required / ratelimit / invalid / suspended)
  const fail = (code: 'required' | 'ratelimit' | 'invalid' | 'suspended', message: string, status: number) => {
    if (isForm) {
      const url = new URL('/login', req.url);
      url.searchParams.set('error', code);
      if (nextPath) url.searchParams.set('next', nextPath);
      return NextResponse.redirect(url, 303);
    }
    return NextResponse.json({ ok: false, message }, { status });
  };

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return fail('required', parsed.error.issues[0]?.message ?? '입력값을 확인해 주세요.', 400);
  }

  // 브루트포스 방어: 계정 단위 + 발신 IP 단위(계정을 바꿔가며 시도하는 크리덴셜 스터핑 차단)
  // IP 를 알 수 없으면(프록시 없이 직접 접근) 모든 클라이언트가 한 버킷을 공유해 서로를 잠그므로
  // 계정 단위 제한만 적용한다.
  const key = `login:${parsed.data.email.toLowerCase()}`;
  const ip = clientIp(req);
  const [tries, ipTries] = await Promise.all([kv.incr(key, 600), ip ? kv.incr(`login:ip:${ip}`, 600) : Promise.resolve(0)]);
  if (tries > 10 || ipTries > 50) {
    return fail('ratelimit', '로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.', 429);
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return fail('invalid', '이메일 또는 비밀번호가 올바르지 않습니다.', 401);
  }
  if (user.status !== 'ACTIVE') {
    return fail('suspended', '이용이 제한된 계정입니다.', 403);
  }

  await createSession(user.id);
  await kv.del(key);

  const home = user.role === 'ADMIN' ? '/admin' : user.role === 'CREATOR' ? '/studio' : '/my';
  const redirect = nextPath ?? home;
  if (isForm) return NextResponse.redirect(new URL(redirect, req.url), 303);
  return NextResponse.json({ ok: true, redirect });
}

/** 같은 사이트 내부 경로만 로그인 후 이동 대상으로 허용한다 (오픈 리다이렉트 방지). */
function safeNextPath(value: FormDataEntryValue | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  if (!/^\/(?![\/\\])/.test(value)) return null;
  if (value.startsWith('/api/') || value.startsWith('/login')) return null;
  return value.length > 512 ? null : value;
}

/** 신뢰 프록시가 붙인 마지막 홉의 주소만 사용한다. 헤더가 없으면 null. */
function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const hops = xff.split(',').map((s) => s.trim()).filter(Boolean);
    return hops[hops.length - 1] ?? null;
  }
  return req.headers.get('x-real-ip') ?? req.headers.get('cf-connecting-ip');
}
