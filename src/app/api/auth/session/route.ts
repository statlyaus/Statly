import { NextResponse } from 'next/server';

import { adminAuth } from '@/lib/firebaseAdmin';
export const runtime = 'nodejs';


const COOKIE_NAME = 'statly_session';

export async function POST(request: Request) {
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
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(expiresIn / 1000),
    });
    return res;
  } catch (error) {
    console.error('Session creation failed:', error);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}

export async function DELETE() {
  try {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, '', {
      httpOnly: true,
      secure: true,
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
