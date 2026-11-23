import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchApi, fetchJson, getApiErrorMessage } from '@/lib/api';
import {
  DEVELOPMENT_AUTH_EMAIL,
  isDevelopmentLogin,
  persistDevelopmentAuthUser,
  resolveLocalDevelopmentAuthPhrase,
} from '@/lib/devAuth';
import { clearSignInExpired, isSignInExpired } from '@/lib/signInExpiry';

const firebaseMocks = vi.hoisted(() => ({
  currentUser: null as null | { getIdToken: (force?: boolean) => Promise<string> },
}));

vi.mock('@/lib/firebase/clientAuth', () => ({
  auth: {
    get currentUser() {
      return firebaseMocks.currentUser;
    },
  },
}));

describe('fetchApi', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    firebaseMocks.currentUser = null;
    clearSignInExpired();
  });

  it('uses same-origin API paths in the browser even when a local API base env is stale', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://localhost:3000');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchApi('leagues/league-1/draft')).resolves.toEqual({ success: true });

    expect(fetchMock).toHaveBeenCalledWith('/api/leagues/league-1/draft', expect.any(Object));
    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
  });

  it('attaches the signed-in development user to internal API requests', async () => {
    vi.stubEnv('NEXT_PUBLIC_STATLY_ENABLE_DEV_AUTH', 'true');
    const localPassphrase = resolveLocalDevelopmentAuthPhrase();

    expect(isDevelopmentLogin(DEVELOPMENT_AUTH_EMAIL, localPassphrase)).toBe(true);
    persistDevelopmentAuthUser();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchApi('drafts/draft-1/pre-queue');

    const [, init] = fetchMock.mock.calls[0];
    const devToken = ['dev', 'statly-dev-tester'].join(':');
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${devToken}`);
  });

  it('reports non-JSON error responses without reading the body twice', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('Chunk failed to load', {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'content-type': 'text/plain' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchApi('user/draft-settings')).rejects.toThrow(
      'HTTP 500: Internal Server Error - Chunk failed to load'
    );
  });

  it('keeps the HTTP status on thrown errors so callers can choose a recovery', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Player already drafted' }), {
          status: 409,
          statusText: 'Conflict',
          headers: { 'content-type': 'application/json' },
        })
      )
    );

    await expect(fetchApi('drafts/draft-1/picks', { method: 'POST' })).rejects.toMatchObject({
      message: 'Player already drafted',
      status: 409,
    });
  });

  it('normalizes legacy and standardized API errors through one contract', () => {
    expect(getApiErrorMessage({ error: 'Legacy failure' }, 400, 'Bad Request')).toBe(
      'Legacy failure'
    );
    expect(
      getApiErrorMessage(
        { success: false, error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } },
        401,
        'Unauthorized'
      )
    ).toBe('Unauthorized - code=UNAUTHORIZED');
    expect(
      getApiErrorMessage({ message: 'Missing', details: 'leagueId' }, 400, 'Bad Request')
    ).toBe('Missing - leagueId');
  });

  it('lets fetchJson consume the standardized nested error envelope', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: { message: 'League not found', code: 'NOT_FOUND' },
        }),
        { status: 404, statusText: 'Not Found', headers: { 'content-type': 'application/json' } }
      )
    );

    await expect(fetchJson('/api/leagues/missing', { fetcher })).rejects.toThrow(
      'League not found - code=NOT_FOUND'
    );
  });

  it('refreshes a refused Firebase token once and returns the retried result', async () => {
    firebaseMocks.currentUser = {
      getIdToken: vi.fn(async (force?: boolean) => (force ? 'fresh-token' : 'stale-token')),
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"error":"Unauthorized"}', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          headers: { 'content-type': 'application/json' },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchApi('leagues/league-1/draft')).resolves.toEqual({ success: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/leagues/league-1/draft', expect.any(Object));
    const [, init] = fetchMock.mock.calls[1];
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fresh-token');
    expect(isSignInExpired()).toBe(false);
  });

  it('reports an expired sign-in and keeps the 401 status when the retry is refused too', async () => {
    firebaseMocks.currentUser = {
      getIdToken: vi.fn(async (force?: boolean) => (force ? 'fresh-token' : 'stale-token')),
    };
    const fetchMock = vi.fn(
      async () =>
        new Response('{"error":"Unauthorized"}', {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchApi('leagues/league-1/draft')).rejects.toMatchObject({ status: 401 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(isSignInExpired()).toBe(true);
  });
});
