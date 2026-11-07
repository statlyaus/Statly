import type { NextApiRequest } from 'next';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  cookies: vi.fn(),
  isServerDevelopmentAuthEnabled: vi.fn(),
  verifyIdToken: vi.fn(),
  verifySessionCookie: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: mocks.headers,
  cookies: mocks.cookies,
}));

vi.mock('@/lib/devAuth', () => ({
  DEVELOPMENT_AUTH_COOKIE: 'statly_dev_user',
  DEVELOPMENT_AUTH_USER_ID: 'statly-dev-tester',
  isServerDevelopmentAuthEnabled: mocks.isServerDevelopmentAuthEnabled,
}));

vi.mock('@/lib/firebaseAdmin', () => ({
  adminAuth: {
    verifyIdToken: mocks.verifyIdToken,
    verifySessionCookie: mocks.verifySessionCookie,
  },
}));

import { getAuthenticatedUserIdFromApiRequest } from '@/lib/nextApiAuth';
import { requireUser } from '@/lib/requireUser';
import {
  getExplicitAuthenticatedUserIdFromServerContext,
  getAuthenticatedUserId,
  getAuthenticatedUserIdFromServerContext,
  resolveAuthenticatedUserId,
} from '@/lib/serverAuth';

/** Firebase Admin rejects with an error carrying an `auth/...` code; outages carry other codes or none. */
function firebaseError(code: string) {
  return Object.assign(new Error(`Firebase Admin error (${code}).`), { code });
}

function store(values: Record<string, string>) {
  return {
    get: (name: string) => (name in values ? { value: values[name] } : undefined),
  };
}

describe('server authentication boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isServerDevelopmentAuthEnabled.mockReturnValue(false);
    mocks.headers.mockResolvedValue(new Headers());
    mocks.cookies.mockResolvedValue(store({}));
  });

  it('prefers a revocation-checked Firebase ID token over the legacy cookie', async () => {
    mocks.verifyIdToken.mockResolvedValue({ uid: 'token-user' });

    await expect(
      resolveAuthenticatedUserId({
        authorization: 'Bearer current-id-token',
        sessionCookie: 'legacy-session',
      })
    ).resolves.toBe('token-user');

    expect(mocks.verifyIdToken).toHaveBeenCalledWith('current-id-token', true);
    expect(mocks.verifySessionCookie).not.toHaveBeenCalled();
  });

  it('does not downgrade to the legacy cookie when an explicit bearer token is invalid', async () => {
    mocks.verifyIdToken.mockRejectedValue(firebaseError('auth/id-token-revoked'));
    mocks.verifySessionCookie.mockResolvedValue({ uid: 'cookie-user' });

    await expect(
      resolveAuthenticatedUserId({
        authorization: 'bearer stale-id-token',
        sessionCookie: 'legacy-session',
      })
    ).resolves.toBeNull();

    expect(mocks.verifyIdToken).toHaveBeenCalledWith('stale-id-token', true);
    expect(mocks.verifySessionCookie).not.toHaveBeenCalled();
  });

  it('uses the legacy cookie only when no bearer token was presented', async () => {
    mocks.verifySessionCookie.mockResolvedValue({ uid: 'cookie-user' });

    await expect(resolveAuthenticatedUserId({ sessionCookie: 'legacy-session' })).resolves.toBe(
      'cookie-user'
    );

    expect(mocks.verifySessionCookie).toHaveBeenCalledWith('legacy-session', true);
  });

  it('returns null without logging for missing or rejected credentials', async () => {
    mocks.verifyIdToken.mockRejectedValue(firebaseError('auth/argument-error'));
    mocks.verifySessionCookie.mockRejectedValue(firebaseError('auth/session-cookie-expired'));

    await expect(
      resolveAuthenticatedUserId({
        authorization: 'Bearer invalid-token',
        sessionCookie: 'expired-session',
      })
    ).resolves.toBeNull();
    await expect(resolveAuthenticatedUserId({})).resolves.toBeNull();
  });

  it.each([
    'auth/id-token-expired',
    'auth/id-token-revoked',
    'auth/argument-error',
    'auth/user-disabled',
    'auth/user-not-found',
  ])('treats a bearer token rejected with %s as signed out', async (code) => {
    mocks.verifyIdToken.mockRejectedValue(firebaseError(code));

    await expect(resolveAuthenticatedUserId({ authorization: 'Bearer bad-token' })).resolves.toBe(
      null
    );
  });

  it.each([
    ['a network failure during the revocation lookup', firebaseError('app/network-error')],
    ['a Firebase Admin internal error', firebaseError('auth/internal-error')],
    ['a misconfigured Admin credential', firebaseError('auth/invalid-credential')],
    ['an uncoded failure', new Error('Firebase Admin integration is disabled')],
  ])('raises %s instead of reporting the bearer token as signed out', async (_label, failure) => {
    mocks.verifyIdToken.mockRejectedValue(failure);

    await expect(resolveAuthenticatedUserId({ authorization: 'Bearer valid-token' })).rejects.toBe(
      failure
    );
  });

  it('raises a session cookie check that could not run instead of reporting signed out', async () => {
    const outage = firebaseError('app/network-error');
    mocks.verifySessionCookie.mockRejectedValue(outage);

    await expect(resolveAuthenticatedUserId({ sessionCookie: 'legacy-session' })).rejects.toBe(
      outage
    );
  });

  it('keeps explicitly enabled development auth ahead of production credentials', async () => {
    mocks.isServerDevelopmentAuthEnabled.mockReturnValue(true);

    await expect(
      resolveAuthenticatedUserId({
        authorization: 'Bearer production-token',
        developmentHeaderUserId: 'statly-dev-tester',
        sessionCookie: 'legacy-session',
      })
    ).resolves.toBe('statly-dev-tester');

    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
    expect(mocks.verifySessionCookie).not.toHaveBeenCalled();
  });

  it('validates real credentials when development auth has no explicit dev identity', async () => {
    mocks.isServerDevelopmentAuthEnabled.mockReturnValue(true);
    mocks.verifyIdToken.mockResolvedValue({ uid: 'verified-development-user' });

    await expect(
      resolveAuthenticatedUserId({ authorization: 'Bearer real-firebase-token' })
    ).resolves.toBe('verified-development-user');

    expect(mocks.verifyIdToken).toHaveBeenCalledWith('real-firebase-token', true);
  });

  it('rejects arbitrary development identities instead of trusting request input', async () => {
    mocks.isServerDevelopmentAuthEnabled.mockReturnValue(true);

    await expect(
      resolveAuthenticatedUserId({ developmentHeaderUserId: 'attacker-selected-user' })
    ).resolves.toBeNull();
    await expect(
      resolveAuthenticatedUserId({ authorization: 'Bearer dev:attacker-selected-user' })
    ).resolves.toBeNull();

    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
  });

  it('applies the same precedence to an App Router request', async () => {
    mocks.verifyIdToken.mockResolvedValue({ uid: 'request-user' });
    const request = new NextRequest('http://localhost:3000/api/leagues', {
      headers: {
        authorization: 'Bearer request-token',
        cookie: 'statly_session=legacy-session',
      },
    });

    await expect(getAuthenticatedUserId(request)).resolves.toBe('request-user');
    expect(mocks.verifyIdToken).toHaveBeenCalledWith('request-token', true);
  });

  it('applies the same precedence to a Pages Router request', async () => {
    mocks.verifyIdToken.mockResolvedValue({ uid: 'pages-user' });
    const request = {
      headers: { authorization: 'Bearer pages-token' },
      cookies: { statly_session: 'legacy-session' },
    } as unknown as NextApiRequest;

    await expect(getAuthenticatedUserIdFromApiRequest(request)).resolves.toBe('pages-user');
    expect(mocks.verifyIdToken).toHaveBeenCalledWith('pages-token', true);
  });

  it('applies the same precedence to server components', async () => {
    mocks.verifyIdToken.mockResolvedValue({ uid: 'server-component-user' });
    mocks.headers.mockResolvedValue(new Headers({ authorization: 'Bearer navigation-token' }));
    mocks.cookies.mockResolvedValue(store({ statly_session: 'legacy-session' }));

    await expect(getAuthenticatedUserIdFromServerContext()).resolves.toBe('server-component-user');
    expect(mocks.verifyIdToken).toHaveBeenCalledWith('navigation-token', true);
  });

  it('requires a presented Firebase credential for explicit server-component authentication', async () => {
    mocks.isServerDevelopmentAuthEnabled.mockReturnValue(true);
    mocks.headers.mockResolvedValue(new Headers({ 'x-auth-user': 'statly-dev-tester' }));
    mocks.cookies.mockResolvedValue(store({ statly_dev_user: 'statly-dev-tester' }));

    await expect(getExplicitAuthenticatedUserIdFromServerContext()).resolves.toBeNull();

    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
    expect(mocks.verifySessionCookie).not.toHaveBeenCalled();
  });

  it('does not treat a development bearer token as an explicit Firebase credential', async () => {
    mocks.isServerDevelopmentAuthEnabled.mockReturnValue(true);
    mocks.verifyIdToken.mockRejectedValue(firebaseError('auth/argument-error'));
    mocks.headers.mockResolvedValue(new Headers({ authorization: 'Bearer dev:statly-dev-tester' }));

    await expect(getExplicitAuthenticatedUserIdFromServerContext()).resolves.toBeNull();

    expect(mocks.verifyIdToken).toHaveBeenCalledWith('dev:statly-dev-tester', true);
  });

  it('revocation-checks an explicitly presented server-component session', async () => {
    mocks.isServerDevelopmentAuthEnabled.mockReturnValue(true);
    mocks.verifySessionCookie.mockResolvedValue({ uid: 'statly-dev-tester' });
    mocks.cookies.mockResolvedValue(
      store({
        statly_dev_user: 'statly-dev-tester',
        statly_session: 'verified-session',
      })
    );

    await expect(getExplicitAuthenticatedUserIdFromServerContext()).resolves.toBe(
      'statly-dev-tester'
    );

    expect(mocks.verifySessionCookie).toHaveBeenCalledWith('verified-session', true);
  });

  it('makes requireUser consume the canonical server-component identity', async () => {
    mocks.verifySessionCookie.mockResolvedValue({ uid: 'required-user' });
    mocks.cookies.mockResolvedValue(store({ statly_session: 'legacy-session' }));

    await expect(requireUser()).resolves.toBe('required-user');

    mocks.verifySessionCookie.mockRejectedValue(firebaseError('auth/session-cookie-revoked'));
    await expect(requireUser()).rejects.toThrow('Authenticated user not found');
  });
});
