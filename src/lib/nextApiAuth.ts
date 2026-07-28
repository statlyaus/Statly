import type { NextApiRequest } from 'next';
import { SESSION_COOKIE_NAME } from '@/lib/authConstants';
import { DEVELOPMENT_AUTH_COOKIE } from '@/lib/devAuth';
import { resolveAuthenticatedUserId } from '@/lib/serverAuth';

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function getAuthenticatedUserIdFromApiRequest(
  req: NextApiRequest
): Promise<string | null> {
  return resolveAuthenticatedUserId({
    authorization: firstHeaderValue(req.headers.authorization),
    developmentHeaderUserId: firstHeaderValue(req.headers['x-auth-user']),
    developmentCookieUserId: req.cookies?.[DEVELOPMENT_AUTH_COOKIE],
    sessionCookie: req.cookies?.[SESSION_COOKIE_NAME],
  });
}
