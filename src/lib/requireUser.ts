import { cookies } from 'next/headers';
import { adminAuth } from '@/lib/firebaseAdmin';

/**
 * Resolve the authenticated user from the statly_session cookie.
 * Throws an error if the user cannot be verified.
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
