import type { NextApiRequest } from 'next';
import { adminAuth } from '@/lib/firebaseAdmin';

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function getAuthenticatedUserIdFromApiRequest(
  req: NextApiRequest
): Promise<string | null> {
  if (process.env.NODE_ENV !== 'production') {
    const devUser = firstHeaderValue(req.headers['x-auth-user']);
    if (devUser) return devUser;
  }

  const authorization = firstHeaderValue(req.headers.authorization);
  if (authorization?.startsWith('Bearer ')) {
    try {
      const decoded = await adminAuth.verifyIdToken(authorization.slice('Bearer '.length), true);
      return decoded.uid ?? null;
    } catch {
      return null;
    }
  }

  const sessionCookie = req.cookies?.statly_session;
  if (!sessionCookie) return null;

  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    return decoded.uid ?? null;
  } catch {
    return null;
  }
}
