import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
  getIdToken: vi.fn(),
  hasCurrentUser: false,
}));

vi.mock('@/lib/firebase/clientAuth', () => ({
  auth: {
    get currentUser() {
      return firebaseMocks.hasCurrentUser ? { getIdToken: firebaseMocks.getIdToken } : null;
    },
  },
}));

describe('authenticatedFetch', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    firebaseMocks.hasCurrentUser = false;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses a Firebase ID token for internal API requests when available', async () => {
    firebaseMocks.hasCurrentUser = true;
    const firebaseToken = ['firebase', 'token'].join('-');
    firebaseMocks.getIdToken.mockResolvedValue(firebaseToken);
    const { authenticatedFetch } = await import('@/lib/authenticatedFetch');

    await authenticatedFetch('/api/leagues/user/user-1', {}, 'user-1');

    expect(fetch).toHaveBeenCalledWith(
      '/api/leagues/user/user-1',
      expect.objectContaining({
        headers: expect.any(Headers),
      })
    );
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${firebaseToken}`);
  });

  it('uses a dev bearer token for internal API requests without Firebase auth', async () => {
    vi.stubEnv('NEXT_PUBLIC_STATLY_ENABLE_DEV_AUTH', 'true');
    const { authenticatedFetch } = await import('@/lib/authenticatedFetch');

    await authenticatedFetch('/api/leagues/user/statly-dev-tester', {}, 'statly-dev-tester');

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const devToken = ['dev', 'statly-dev-tester'].join(':');
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${devToken}`);
  });

  it('preserves an existing authorization header', async () => {
    const { authenticatedFetch } = await import('@/lib/authenticatedFetch');

    const existingToken = ['existing', 'token'].join('-');

    await authenticatedFetch('/api/leagues/user/user-1', {
      headers: { Authorization: `Bearer ${existingToken}` },
    });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${existingToken}`);
  });

  it('does not attach credentials to non-API requests', async () => {
    const { authenticatedFetch } = await import('@/lib/authenticatedFetch');

    await authenticatedFetch('/assets/logo.svg', {}, 'user-1');

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(new Headers(init?.headers).get('Authorization')).toBeNull();
  });

  it('treats an absolute same-origin API URL as internal, and another origin as external', async () => {
    firebaseMocks.hasCurrentUser = true;
    firebaseMocks.getIdToken.mockResolvedValue('token');
    const { authenticatedFetch } = await import('@/lib/authenticatedFetch');

    await authenticatedFetch(`${window.location.origin}/api/leagues/league-1/waivers?x=1`);
    await authenticatedFetch('https://elsewhere.example/api/leagues/league-1');

    const authorizations = vi
      .mocked(fetch)
      .mock.calls.map(([, init]) => new Headers(init?.headers).get('Authorization'));
    expect(authorizations).toEqual(['Bearer token', null]);
  });

  describe('when the server refuses the credential', () => {
    const unauthorized = () => new Response('{"error":"Unauthorized"}', { status: 401 });
    const firebaseError = (code: string) => Object.assign(new Error(code), { code });

    async function load() {
      const { authenticatedFetch } = await import('@/lib/authenticatedFetch');
      const expiry = await import('@/lib/signInExpiry');
      return { authenticatedFetch, ...expiry };
    }

    function sentAuthorization(call: number): string | null {
      const [, init] = vi.mocked(fetch).mock.calls[call];
      return new Headers(init?.headers).get('Authorization');
    }

    beforeEach(() => {
      firebaseMocks.hasCurrentUser = true;
      firebaseMocks.getIdToken.mockImplementation(async (forceRefresh?: boolean) =>
        forceRefresh ? 'fresh-token' : 'stale-token'
      );
    });

    it('forces a fresh token and retries once, without raising the prompt', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(unauthorized())
        .mockResolvedValueOnce(new Response('{}', { status: 200 }));
      const { authenticatedFetch, isSignInExpired } = await load();

      const response = await authenticatedFetch('/api/leagues/league-1', {
        method: 'POST',
        body: '{}',
      });

      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(firebaseMocks.getIdToken).toHaveBeenCalledWith(true);
      expect(sentAuthorization(0)).toBe('Bearer stale-token');
      expect(sentAuthorization(1)).toBe('Bearer fresh-token');
      expect(isSignInExpired()).toBe(false);
    });

    it('reports the sign-in as expired after one failed retry, and never sends a third time', async () => {
      vi.mocked(fetch).mockImplementation(async () => unauthorized());
      const { authenticatedFetch, isSignInExpired } = await load();

      const response = await authenticatedFetch('/api/leagues/league-1');

      expect(response.status).toBe(401);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(isSignInExpired()).toBe(true);
    });

    it('reports expired without a retry when the forced refresh fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(unauthorized());
      firebaseMocks.getIdToken.mockImplementation(async (forceRefresh?: boolean) => {
        if (forceRefresh) throw firebaseError('auth/user-token-expired');
        return 'stale-token';
      });
      const { authenticatedFetch, isSignInExpired } = await load();

      const response = await authenticatedFetch('/api/leagues/league-1');

      expect(response.status).toBe(401);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(isSignInExpired()).toBe(true);
    });

    it('returns the 401 without raising the prompt when the refresh could not run', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(unauthorized());
      firebaseMocks.getIdToken.mockImplementation(async (forceRefresh?: boolean) => {
        if (forceRefresh) throw firebaseError('auth/network-request-failed');
        return 'stale-token';
      });
      const { authenticatedFetch, isSignInExpired } = await load();

      const response = await authenticatedFetch('/api/leagues/league-1');

      expect(response.status).toBe(401);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(isSignInExpired()).toBe(false);
    });

    it('throws an offline token read as before, without raising the prompt', async () => {
      firebaseMocks.getIdToken.mockRejectedValue(firebaseError('auth/network-request-failed'));
      const { authenticatedFetch, isSignInExpired } = await load();

      await expect(authenticatedFetch('/api/leagues/league-1')).rejects.toMatchObject({
        code: 'auth/network-request-failed',
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(isSignInExpired()).toBe(false);
    });

    it('reports expired when the token cannot be read before sending', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(unauthorized());
      firebaseMocks.getIdToken.mockRejectedValue(firebaseError('auth/user-disabled'));
      const { authenticatedFetch, isSignInExpired } = await load();

      const response = await authenticatedFetch('/api/leagues/league-1');

      expect(response.status).toBe(401);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(sentAuthorization(0)).toBeNull();
      expect(isSignInExpired()).toBe(true);
    });

    it('reports expired without a retry when nobody is signed in', async () => {
      firebaseMocks.hasCurrentUser = false;
      vi.mocked(fetch).mockResolvedValueOnce(unauthorized());
      const { authenticatedFetch, isSignInExpired } = await load();

      await authenticatedFetch('/api/leagues/league-1');

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(isSignInExpired()).toBe(true);
    });

    it('does not retry or report when the caller supplied its own credential', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(unauthorized());
      const { authenticatedFetch, isSignInExpired } = await load();

      await authenticatedFetch('/api/leagues/league-1', {
        headers: { Authorization: 'Bearer caller-token' },
      });

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(isSignInExpired()).toBe(false);
    });

    it('shares one forced refresh between requests refused at the same time', async () => {
      vi.mocked(fetch).mockImplementation(async (_input, init) =>
        new Headers(init?.headers).get('Authorization') === 'Bearer fresh-token'
          ? new Response('{}', { status: 200 })
          : unauthorized()
      );
      const { authenticatedFetch } = await load();

      await Promise.all([
        authenticatedFetch('/api/leagues/league-1'),
        authenticatedFetch('/api/leagues/league-2'),
      ]);

      const forcedRefreshes = firebaseMocks.getIdToken.mock.calls.filter(
        ([force]) => force === true
      );
      expect(forcedRefreshes).toHaveLength(1);
    });

    it('sends once without a refresh while the sign-in is already expired', async () => {
      vi.mocked(fetch).mockImplementation(async () => unauthorized());
      const { authenticatedFetch, reportSignInExpired } = await load();
      reportSignInExpired();

      await authenticatedFetch('/api/leagues/league-1');

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(firebaseMocks.getIdToken).not.toHaveBeenCalledWith(true);
    });

    it('clears the expired state once a credentialed request succeeds', async () => {
      const { authenticatedFetch, isSignInExpired, reportSignInExpired } = await load();
      reportSignInExpired();

      await authenticatedFetch('/api/leagues/league-1');

      expect(isSignInExpired()).toBe(false);
    });

    it('keeps the expired state on a non-401 failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 500 }));
      const { authenticatedFetch, isSignInExpired, reportSignInExpired } = await load();
      reportSignInExpired();

      await authenticatedFetch('/api/leagues/league-1');

      expect(isSignInExpired()).toBe(true);
    });

    it('retries a Request input with its body intact', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(unauthorized())
        .mockResolvedValueOnce(new Response('{}', { status: 200 }));
      const { authenticatedFetch } = await load();

      await authenticatedFetch(
        new Request(`${window.location.origin}/api/leagues/league-1`, {
          method: 'POST',
          body: 'payload',
        })
      );

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(sentAuthorization(1)).toBe('Bearer fresh-token');
      const [retried] = vi.mocked(fetch).mock.calls[1];
      expect(await (retried as Request).text()).toBe('payload');
    });
  });
});
