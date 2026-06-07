import { auth } from '@/lib/firebaseClient';

function isInternalApiRequest(input: RequestInfo | URL): boolean {
  if (typeof input === 'string') {
    return input.startsWith('/api/');
  }

  if (input instanceof URL) {
    return input.origin === window.location.origin && input.pathname.startsWith('/api/');
  }

  try {
    const url = new URL(input.url, window.location.origin);
    return url.origin === window.location.origin && url.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

async function getAuthHeader(userId?: string): Promise<string | null> {
  const currentUser = auth?.currentUser;
  if (currentUser) {
    const token = await currentUser.getIdToken();
    return `Bearer ${token}`;
  }

  if (process.env.NODE_ENV !== 'production' && userId) {
    return `Bearer dev:${userId}`;
  }

  return null;
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  userId?: string
): Promise<Response> {
  const headers = new Headers(init.headers);

  if (!headers.has('Authorization') && isInternalApiRequest(input)) {
    const authHeader = await getAuthHeader(userId);
    if (authHeader) {
      headers.set('Authorization', authHeader);
    }
  }

  return fetch(input, {
    ...init,
    headers,
  });
}
