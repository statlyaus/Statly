import { NextRequest } from 'next/server';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const processDueLeagueTradesMock = vi.fn();

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

vi.mock('@/server/leagues/trades/tradeService', () => ({
  processDueLeagueTrades: (...args: unknown[]) => processDueLeagueTradesMock(...args),
}));

const { GET, POST } = await import('./route');

const URL_BASE = 'http://localhost/api/cron/trades';

describe('/api/cron/trades authorization', () => {
  beforeEach(() => {
    processDueLeagueTradesMock.mockResolvedValue(2);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects every request when CRON_SECRET is unset outside development', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', '');

    const response = await GET(
      new NextRequest(URL_BASE, { headers: { authorization: 'Bearer anything' } })
    );

    expect(response.status).toBe(401);
    expect(processDueLeagueTradesMock).not.toHaveBeenCalled();
  });

  it.each(['GET', 'POST'] as const)('rejects a wrong secret on %s', async (method) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    const handler = method === 'GET' ? GET : POST;

    const response = await handler(
      new NextRequest(URL_BASE, { method, headers: { authorization: 'Bearer wrong-secret' } })
    );

    expect(response.status).toBe(401);
    expect(processDueLeagueTradesMock).not.toHaveBeenCalled();
  });

  it('processes due trades with the correct Vercel bearer secret', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'cron-secret');

    const response = await GET(
      new NextRequest(URL_BASE, { headers: { authorization: 'Bearer cron-secret' } })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, processed: 2 });
    expect(processDueLeagueTradesMock).toHaveBeenCalledTimes(1);
  });
});
