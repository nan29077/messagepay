import { NextResponse } from 'next/server';
import { destroySession } from '@/server/auth';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  await destroySession();
  return NextResponse.redirect(new URL('/', req.url), 303);
}
