import { auth } from '@/lib/firebase/clientAuth';
import { isDevelopmentAuthEnabled } from '@/lib/devAuth';
import {
  clearSignInExpired,
  isEndedSessionError,
  isSignInExpired,
  reportSignInExpired,
} from '@/lib/signInExpiry';

// Same-origin /api requests only, whether given as a relative path, an absolute URL string, a URL
// or a Request.
function isInternalApiRequest(input: RequestInfo | URL): boolean {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try {
    const url = new URL(href, window.location.origin);
    return url.origin === window.location.origin && url.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

/**
 * Resolve the credential to send with an outgoing request.
 *
 * A signed-in browser session supplies a Firebase ID token. Local development without a signed-in
 * user falls back to the development credential. Returns null when neither is available.
 */
export async function getAuthHeader(userId?: string): Promise<string | null> {
  const currentUser = auth?.currentUser;
  if (currentUser) {
    const token = await currentUser.getIdToken();
    return `Bearer ${token}`;
  }

  if (isDevelopmentAuthEnabled() && userId) {
    return `Bearer dev:${userId}`;
  }

  return null;
}

// Requests refused at the same moment share one forced refresh instead of each asking Firebase.
let forcedRefresh: Promise<string> | null = null;

function forceFreshIdToken(user: { getIdToken: (forceRefresh?: boolean) => Promise<string> }) {
  forcedRefresh ??= user.getIdToken(true).finally(() => {
    forcedRefresh = null;
  });
  return forcedRefresh;
}

/**
 * Send a request with the caller's credential and recover once from a refused sign-in.
 *
 * On a 401 the Firebase ID token is refreshed by force and the request is sent exactly once more.
 * A second 401, a refresh Firebase refuses because the session ended, or no signed-in user marks
 * the sign-in as expired, which raises the app-wide "sign in again" prompt; while it is expired a
 * 401 is not retried. A refresh that could not run (offline) marks nothing: the 401 is returned, or
 * the token error thrown, as before. A credential the caller set itself is left alone. Routes
 * authenticate before doing any work, so a refused request changed nothing and is safe to send
 * again. `send` must build a fresh request each call.
 */
export async function fetchWithSignInRecovery(
  send: (headers: Headers) => Promise<Response>,
  callerHeaders: Headers,
  userId?: string
): Promise<Response> {
  if (callerHeaders.has('Authorization')) return send(callerHeaders);

  const headers = new Headers(callerHeaders);
  let credential: string | null;
  try {
    credential = await getAuthHeader(userId);
  } catch (error) {
    // Reading a token over an hour old refreshes it, so a revoked or disabled account fails here.
    if (!isEndedSessionError(error)) throw error;
    reportSignInExpired();
    return send(headers);
  }
  if (credential) headers.set('Authorization', credential);

  const response = await send(headers);
  if (response.ok && credential) clearSignInExpired();
  if (response.status !== 401) return response;

  const user = auth?.currentUser;
  if (!user || isSignInExpired()) {
    reportSignInExpired();
    return response;
  }

  let freshToken: string;
  try {
    freshToken = await forceFreshIdToken(user);
  } catch (error) {
    if (isEndedSessionError(error)) reportSignInExpired();
    return response;
  }

  const retryHeaders = new Headers(headers);
  retryHeaders.set('Authorization', `Bearer ${freshToken}`);
  const retried = await send(retryHeaders);
  if (retried.status === 401) reportSignInExpired();
  else if (retried.ok) clearSignInExpired();
  return retried;
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  userId?: string
): Promise<Response> {
  if (!isInternalApiRequest(input)) {
    return fetch(input, init);
  }

  // A Request body can be read once, so each send uses a copy. A ReadableStream in `init.body`
  // cannot be replayed; no caller sends one.
  const original = input instanceof Request ? input.clone() : input;
  return fetchWithSignInRecovery(
    (headers) =>
      fetch(original instanceof Request ? original.clone() : original, { ...init, headers }),
    new Headers(init.headers),
    userId
  );
}
