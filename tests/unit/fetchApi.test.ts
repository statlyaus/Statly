import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchApi } from '@/lib/api';
import {
  DEVELOPMENT_AUTH_EMAIL,
  isDevelopmentLogin,
  persistDevelopmentAuthUser,
  resolveLocalDevelopmentAuthPhrase,
} from '@/lib/devAuth';

describe('fetchApi', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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
});
