import type { NextRequest } from 'next/server';

import { adminAuth } from '@/lib/firebaseAdmin';
import { getBypassUserId, isAuthBypassEnabled } from '@/lib/authBypass';
import { logger } from '@/lib/logger';

/**
 * Resolve the authenticated user id from the request.
 * - In development: trusts x-auth-user header injected by middleware (Bearer dev:<userId>)
 * - In production: verifies Firebase session cookie (statly_session)
 */
export async function getUserIdFromRequest(request: NextRequest): Promise<string | null> {
  if (isAuthBypassEnabled()) {
    return getBypassUserId();
  }
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
    logger.warn('Session cookie verification failed', {
      hasAuthEmulator: Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST),
    });
    return null;
  }
}

// Verify a Firebase ID token from an Authorization: Bearer <token> header
export async function validateAuthToken(token: string): Promise<string | null> {
  if (isAuthBypassEnabled()) {
    return getBypassUserId();
  }
  try {
    const decoded = await adminAuth.verifyIdToken(token, true);
    return decoded.uid ?? null;
  } catch (error) {
    logger.warn('ID token verification failed', {
      message: error instanceof Error ? error.message : String(error),
      hasAuthEmulator: Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST),
    });
    if (process.env.NODE_ENV !== 'production') {
      try {
        const payload = token.split('.')[1];
        if (!payload) return null;
        const decoded = JSON.parse(
          Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
        ) as { user_id?: string; sub?: string };
        return decoded.user_id ?? decoded.sub ?? null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// Convenience: resolve user from Authorization header or session cookie
export async function getAuthenticatedUserId(request: NextRequest): Promise<string | null> {
  if (isAuthBypassEnabled()) {
    return getBypassUserId();
  }
  const bearer = request.headers.get('authorization');
  if (bearer?.startsWith('Bearer ')) {
    const token = bearer.slice('Bearer '.length);
    const uid = await validateAuthToken(token);
    if (uid) return uid;
  }
  return getUserIdFromRequest(request);
}
