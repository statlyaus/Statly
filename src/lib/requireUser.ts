import { cookies } from 'next/headers';
import { adminAuth } from '@/lib/firebaseAdmin';

/**
 * Resolve the authenticated user from the statly_session cookie.
 * Throws an error if the user cannot be verified.
 */
export async function requireUser(): Promise<string> {
  // TODO: Move to a shared constants file
  const SESSION_COOKIE_NAME = 'statly_session';
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) {
    throw new Error('Session cookie not found');
  }
  const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
  return decoded.uid;
}
