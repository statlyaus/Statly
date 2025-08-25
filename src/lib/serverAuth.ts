import type { NextRequest } from 'next/server';
import { adminAuth } from '@/lib/firebaseAdmin';

/**
 * Resolve the authenticated user id from the request.
 * - In development: trusts x-auth-user header injected by middleware (Bearer dev:<userId>)
 * - In production: verifies Firebase session cookie (statly_session)
 */
export async function getUserIdFromRequest(request: NextRequest): Promise<string | null> {
  if (process.env.NODE_ENV !== 'production') {
    const devUser = request.headers.get('x-auth-user');
    if (devUser) return devUser;
  }

  const sessionCookie = request.cookies.get('statly_session')?.value;
  if (!sessionCookie) return null;

  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    return decoded.uid ?? null;
  } catch {
    return null;
  }
}
