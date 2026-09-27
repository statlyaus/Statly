import { NextRequest } from 'next/server';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const URL_BASE = 'http://localhost/api/cron/prune-lobby';

describe('GET /api/cron/prune-lobby authorization', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects every request when CRON_SECRET is unset outside development', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', '');

    const response = await GET(new NextRequest(`${URL_BASE}?token=anything`));

    expect(response.status).toBe(401);
  });

  it('rejects a wrong secret', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'cron-secret');

    const response = await GET(new NextRequest(`${URL_BASE}?token=wrong-secret`));

    expect(response.status).toBe(401);
  });

  it('accepts the correct secret', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'cron-secret');

    const response = await GET(new NextRequest(`${URL_BASE}?token=cron-secret`));

    expect(response.status).toBe(200);
  });
});
