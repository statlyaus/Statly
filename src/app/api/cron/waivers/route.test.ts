import { NextRequest } from 'next/server';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const processDueLeagueWaiversMock = vi.fn();

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

vi.mock('@/server/waivers/waiverSchedule', () => ({
  processDueLeagueWaivers: (...args: unknown[]) => processDueLeagueWaiversMock(...args),
}));

const { GET, POST } = await import('./route');

const URL_BASE = 'http://localhost/api/cron/waivers';

describe('/api/cron/waivers', () => {
  beforeEach(() => {
    processDueLeagueWaiversMock.mockResolvedValue({ ran: true, leagues: [] });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    processDueLeagueWaiversMock.mockReset();
  });

  it('rejects every request when CRON_SECRET is unset outside development', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', '');

    const response = await GET(
      new NextRequest(URL_BASE, { headers: { authorization: 'Bearer anything' } })
    );

    expect(response.status).toBe(401);
    expect(processDueLeagueWaiversMock).not.toHaveBeenCalled();
  });

  it.each(['GET', 'POST'] as const)('rejects a wrong secret on %s', async (method) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    const handler = method === 'GET' ? GET : POST;

    const response = await handler(
      new NextRequest(URL_BASE, { method, headers: { authorization: 'Bearer wrong-secret' } })
    );

    expect(response.status).toBe(401);
    expect(processDueLeagueWaiversMock).not.toHaveBeenCalled();
  });

  it('runs the schedule with the correct secret and is never cached', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'cron-secret');

    const response = await GET(
      new NextRequest(URL_BASE, { headers: { authorization: 'Bearer cron-secret' } })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({ ok: true, ran: true, leagues: [] });
    expect(processDueLeagueWaiversMock).toHaveBeenCalledTimes(1);
  });
});
