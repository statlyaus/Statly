import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/authConstants';
import { isSameOriginRequest } from '@/lib/requestOrigin';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Clears the legacy session cookie on sign-out. Nothing mints one any more (the 14-day cookie
 * exchange had no caller); the server still reads an existing cookie until it expires.
 */
export async function DELETE(request: Request): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  }

  try {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE_NAME, '', {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
    return res;
  } catch (error) {
    console.error('Session deletion failed:', error);
    return NextResponse.json({ error: 'Failed to clear session' }, { status: 500 });
  }
}
