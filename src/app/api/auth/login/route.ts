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
  if (isForm) {
    const form = await req.formData().catch(() => null);
    payload = {
      email: String(form?.get('email') ?? ''),
      password: String(form?.get('password') ?? ''),
    };
  } else {
    payload = (await req.json().catch(() => ({}))) as typeof payload;
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: parsed.error.issues[0]?.message }, { status: 400 });
  }

  // 브루트포스 방어: 계정 단위 + 발신 IP 단위(계정을 바꿔가며 시도하는 크리덴셜 스터핑 차단)
  const key = `login:${parsed.data.email.toLowerCase()}`;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const ipKey = `login:ip:${ip}`;
  const [tries, ipTries] = await Promise.all([kv.incr(key, 600), kv.incr(ipKey, 600)]);
  if (tries > 10 || ipTries > 50) {
    return NextResponse.json({ ok: false, message: '로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.' }, { status: 429 });
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return NextResponse.json({ ok: false, message: '이메일 또는 비밀번호가 올바르지 않습니다.' }, { status: 401 });
  }
  if (user.status !== 'ACTIVE') {
    return NextResponse.json({ ok: false, message: '이용이 제한된 계정입니다.' }, { status: 403 });
  }

  await createSession(user.id);
  await kv.del(key);

  const redirect = user.role === 'ADMIN' ? '/admin' : user.role === 'CREATOR' ? '/studio' : '/my';
  if (isForm) return NextResponse.redirect(new URL(redirect, req.url), 303);
  return NextResponse.json({ ok: true, redirect });
}
