import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
  getIdToken: vi.fn(),
  hasCurrentUser: false,
}));

vi.mock('@/lib/firebaseClient', () => ({
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
});
