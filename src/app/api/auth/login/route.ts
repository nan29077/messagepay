import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { kv } from '@/server/redis';
import { createSession, verifyPassword } from '@/server/auth';

export const runtime = 'nodejs';

const schema = z.object({
  email: z.string().email('이메일 형식이 올바르지 않습니다.'),
  password: z.string().min(1, '비밀번호를 입력해 주세요.'),
});

export async function POST(req: Request) {
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

  // 계정 단위 브루트포스 방어
  const key = `login:${parsed.data.email.toLowerCase()}`;
  const tries = await kv.incr(key, 600);
  if (tries > 10) {
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
