import { NextResponse } from 'next/server';

import { adminAuth } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
export const runtime = 'nodejs';

const COOKIE_NAME = 'statly_session';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const { idToken, expiresInDays = 7 } = await request.json();
    if (!idToken || typeof idToken !== 'string') {
      return NextResponse.json({ error: 'Missing idToken' }, { status: 400 });
    }

    const decoded = await adminAuth.verifyIdToken(idToken, true);
    // Optionally reject if token is revoked/invalid; verifyIdToken with checkRevoked=true would be in another call

    const expiresIn = Math.min(Math.max(1, Number(expiresInDays)), 14) * 24 * 60 * 60 * 1000; // clamp 1..14 days
    const sessionCookie = await adminAuth.createSessionCookie(idToken, { expiresIn });

    const res = NextResponse.json({ ok: true, uid: decoded.uid });
    res.cookies.set(COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(expiresIn / 1000),
    });
    return res;
  } catch (error) {
    logger.error(
      'Session creation failed',
      error instanceof Error ? error : new Error(String(error))
    );
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}

export async function DELETE(): Promise<NextResponse> {
  try {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, '', {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
    return res;
  } catch (error) {
    logger.error(
      'Session deletion failed',
      error instanceof Error ? error : new Error(String(error))
    );
    return NextResponse.json({ error: 'Failed to clear session' }, { status: 500 });
  }
}
