import type { NextRequest } from 'next/server';
import { adminAuth } from '@/lib/firebaseAdmin';
import {
  DEVELOPMENT_AUTH_COOKIE,
  DEVELOPMENT_AUTH_USER_ID,
  isDevelopmentAuthEnabled,
} from '@/lib/devAuth';

/**
 * Resolve the authenticated user id from the request.
 * - In development: trusts x-auth-user header injected by middleware (Bearer dev:<userId>)
 * - In production: verifies Firebase session cookie (statly_session)
 */
export async function getUserIdFromRequest(request: NextRequest): Promise<string | null> {
  if (isDevelopmentAuthEnabled()) {
    const devUser = request.headers.get('x-auth-user');
    if (devUser) return devUser;

    const devCookieUser = request.cookies.get(DEVELOPMENT_AUTH_COOKIE)?.value;
    if (devCookieUser) return devCookieUser;

    return (
      process.env.BYPASS_UID ??
      process.env.NEXT_PUBLIC_BYPASS_UID ??
      DEVELOPMENT_AUTH_USER_ID
    );
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

// Verify a Firebase ID token from an Authorization: Bearer <token> header
export async function validateAuthToken(token: string): Promise<string | null> {
  if (isDevelopmentAuthEnabled() && token.startsWith('dev:')) {
    return token.slice('dev:'.length) || null;
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token, true);
    return decoded.uid ?? null;
  } catch {
    return null;
  }
}

// Convenience: resolve user from Authorization header or session cookie
export async function getAuthenticatedUserId(request: NextRequest): Promise<string | null> {
  const bearer = request.headers.get('authorization');
  if (bearer?.startsWith('Bearer ')) {
    const token = bearer.slice('Bearer '.length);
    const uid = await validateAuthToken(token);
    if (uid) return uid;
  }
  return getUserIdFromRequest(request);
}
