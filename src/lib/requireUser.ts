import { cookies } from 'next/headers';
import { adminAuth } from '@/lib/firebaseAdmin';

/**
 * Resolve the authenticated user's UID from the 'statly_session' cookie.
 *
 * Throws Error('Unauthorized') if the cookie is missing. If verification fails or
 * the session is revoked, the underlying error from the Firebase Admin SDK is propagated.
 *
 * @returns The authenticated user's UID.
 */
export async function requireUser(): Promise<string> {
  const cookieStore = cookies();
  const sessionCookie = cookieStore.get('statly_session')?.value;
  if (!sessionCookie) {
    throw new Error('Unauthorized');
  }
  const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
  return decoded.uid;
}
