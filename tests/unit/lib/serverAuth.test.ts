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
  getAuthenticatedUserId,
  getAuthenticatedUserIdFromServerContext,
  resolveAuthenticatedUserId,
} from '@/lib/serverAuth';

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
    mocks.verifyIdToken.mockRejectedValue(new Error('revoked token'));
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
    mocks.verifyIdToken.mockRejectedValue(new Error('invalid token'));
    mocks.verifySessionCookie.mockRejectedValue(new Error('expired session'));

    await expect(
      resolveAuthenticatedUserId({
        authorization: 'Bearer invalid-token',
        sessionCookie: 'expired-session',
      })
    ).resolves.toBeNull();
    await expect(resolveAuthenticatedUserId({})).resolves.toBeNull();
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

  it('makes requireUser consume the canonical server-component identity', async () => {
    mocks.verifySessionCookie.mockResolvedValue({ uid: 'required-user' });
    mocks.cookies.mockResolvedValue(store({ statly_session: 'legacy-session' }));

    await expect(requireUser()).resolves.toBe('required-user');

    mocks.verifySessionCookie.mockRejectedValue(new Error('revoked session'));
    await expect(requireUser()).rejects.toThrow('Authenticated user not found');
  });
});
