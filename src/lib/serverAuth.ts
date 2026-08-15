import type { NextRequest } from 'next/server';
import { cookies, headers } from 'next/headers';
import { SESSION_COOKIE_NAME } from '@/lib/authConstants';
import { adminAuth } from '@/lib/firebaseAdmin';
import {
  DEVELOPMENT_AUTH_COOKIE,
  DEVELOPMENT_AUTH_USER_ID,
  isServerDevelopmentAuthEnabled,
} from '@/lib/devAuth';

export interface ServerAuthCredentials {
  authorization?: string | null;
  developmentHeaderUserId?: string | null;
  developmentCookieUserId?: string | null;
  sessionCookie?: string | null;
}

function getBearerToken(authorization: string | null | undefined): string | null {
  const match = authorization?.trim().match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

function getDevelopmentUserId(credentials: ServerAuthCredentials): string | null {
  if (!isServerDevelopmentAuthEnabled()) return null;

  if (credentials.developmentHeaderUserId === DEVELOPMENT_AUTH_USER_ID) {
    return DEVELOPMENT_AUTH_USER_ID;
  }
  if (credentials.developmentCookieUserId === DEVELOPMENT_AUTH_USER_ID) {
    return DEVELOPMENT_AUTH_USER_ID;
  }

  const token = getBearerToken(credentials.authorization);
  if (token?.startsWith('dev:')) {
    return token.slice('dev:'.length) === DEVELOPMENT_AUTH_USER_ID
      ? DEVELOPMENT_AUTH_USER_ID
      : null;
  }

  const hasSuppliedCredential = Boolean(
    credentials.authorization ||
    credentials.sessionCookie ||
    credentials.developmentHeaderUserId ||
    credentials.developmentCookieUserId
  );
  if (hasSuppliedCredential) return null;

  const configuredUserId = process.env.BYPASS_UID ?? process.env.NEXT_PUBLIC_BYPASS_UID;
  return configuredUserId === DEVELOPMENT_AUTH_USER_ID
    ? configuredUserId
    : DEVELOPMENT_AUTH_USER_ID;
}

async function validateFirebaseIdToken(token: string): Promise<string | null> {
  try {
    const decoded = await adminAuth.verifyIdToken(token, true);
    return decoded.uid ?? null;
  } catch {
    return null;
  }
}

async function validateFirebaseSessionCookie(sessionCookie: string): Promise<string | null> {
  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    return decoded.uid ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve a server identity from normalized request credentials.
 *
 * Firebase ID tokens are the primary production credential. The session cookie is retained as a
 * migration fallback until every authenticated browser request uses the same-origin token transport.
 * Expected missing, expired, invalid, and revoked credentials resolve to null without noisy logging.
 */
export async function resolveAuthenticatedUserId(
  credentials: ServerAuthCredentials
): Promise<string | null> {
  const developmentUserId = getDevelopmentUserId(credentials);
  if (developmentUserId) return developmentUserId;

  const token = getBearerToken(credentials.authorization);
  if (token) {
    return validateAuthToken(token);
  }

  if (!credentials.sessionCookie) return null;

  return validateFirebaseSessionCookie(credentials.sessionCookie);
}

/**
 * Resolve only a presented Firebase credential.
 *
 * Private development tools use this stricter boundary so enabling the credential-free local auth
 * fallback cannot make protected evidence readable without an authenticated browser session.
 */
export async function resolveExplicitAuthenticatedUserId(
  credentials: Pick<ServerAuthCredentials, 'authorization' | 'sessionCookie'>
): Promise<string | null> {
  const token = getBearerToken(credentials.authorization);
  if (token) return validateFirebaseIdToken(token);

  if (!credentials.sessionCookie) return null;
  return validateFirebaseSessionCookie(credentials.sessionCookie);
}

/** Verify one Firebase ID token, including revocation, without consulting fallback credentials. */
export async function validateAuthToken(token: string): Promise<string | null> {
  if (isServerDevelopmentAuthEnabled() && token.startsWith('dev:')) {
    return token.slice('dev:'.length) === DEVELOPMENT_AUTH_USER_ID
      ? DEVELOPMENT_AUTH_USER_ID
      : null;
  }

  return validateFirebaseIdToken(token);
}

/** Resolve identity for an App Router request. */
export async function getUserIdFromRequest(request: NextRequest): Promise<string | null> {
  return resolveAuthenticatedUserId({
    authorization: request.headers.get('authorization'),
    developmentHeaderUserId: request.headers.get('x-auth-user'),
    developmentCookieUserId: request.cookies.get(DEVELOPMENT_AUTH_COOKIE)?.value,
    sessionCookie: request.cookies.get(SESSION_COOKIE_NAME)?.value,
  });
}

export const getAuthenticatedUserId = getUserIdFromRequest;

/**
 * Resolve identity from an App Router server component context.
 * Returns null for expected unauthenticated states so callers own redirect or fallback behavior.
 */
export async function getAuthenticatedUserIdFromServerContext(): Promise<string | null> {
  const [headerStore, cookieStore] = await Promise.all([headers(), cookies()]);

  return resolveAuthenticatedUserId({
    authorization: headerStore.get('authorization'),
    developmentHeaderUserId: headerStore.get('x-auth-user'),
    developmentCookieUserId: cookieStore.get(DEVELOPMENT_AUTH_COOKIE)?.value,
    sessionCookie: cookieStore.get(SESSION_COOKIE_NAME)?.value,
  });
}

/** Resolve a presented Firebase credential from an App Router server-component context. */
export async function getExplicitAuthenticatedUserIdFromServerContext(): Promise<string | null> {
  const [headerStore, cookieStore] = await Promise.all([headers(), cookies()]);

  return resolveExplicitAuthenticatedUserId({
    authorization: headerStore.get('authorization'),
    sessionCookie: cookieStore.get(SESSION_COOKIE_NAME)?.value,
  });
}
