import { NextRequest } from 'next/server';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const URL_BASE = 'http://localhost/api/cron/daily';

describe('GET /api/cron/daily authorization', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects every request when CRON_SECRET is unset outside development', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', '');

    const unauthenticated = await GET(new NextRequest(URL_BASE));
    const withToken = await GET(new NextRequest(`${URL_BASE}?token=anything`));

    expect(unauthenticated.status).toBe(401);
    expect(withToken.status).toBe(401);
  });

  it('allows requests without CRON_SECRET only in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CRON_SECRET', '');

    const response = await GET(new NextRequest(URL_BASE));

    expect(response.status).toBe(200);
  });

  it.each([
    ['missing', new NextRequest(URL_BASE)],
    ['wrong query token', new NextRequest(`${URL_BASE}?token=wrong-secret`)],
    [
      'wrong bearer token',
      new NextRequest(URL_BASE, { headers: { authorization: 'Bearer wrong-secret' } }),
    ],
    ['secret prefix', new NextRequest(`${URL_BASE}?token=cron-secre`)],
  ])('rejects a %s secret', async (_label, request) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'cron-secret');

    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: 'unauthorized' });
  });

  it.each([
    ['query token', new NextRequest(`${URL_BASE}?token=cron-secret`)],
    [
      'x-cron-secret header',
      new NextRequest(URL_BASE, { headers: { 'x-cron-secret': 'cron-secret' } }),
    ],
    [
      'Vercel bearer header',
      new NextRequest(URL_BASE, { headers: { authorization: 'Bearer cron-secret' } }),
    ],
  ])('accepts the correct secret via %s', async (_label, request) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'cron-secret');

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });
});
