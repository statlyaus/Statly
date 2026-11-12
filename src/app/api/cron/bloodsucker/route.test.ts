import { NextRequest } from 'next/server';

import { afterEach, describe, expect, it, vi } from 'vitest';

const sweepMock = vi.fn();
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/leagues/bloodsuckerAutoFill', () => ({
  sweepBloodsuckerWindows: (...args: unknown[]) => sweepMock(...args),
}));

const { GET, POST } = await import('./route');

const URL_BASE = 'http://localhost/api/cron/bloodsucker';
const authorised = () => {
  vi.stubEnv('CRON_SECRET', 'secret');
  return new NextRequest(URL_BASE, { headers: { authorization: 'Bearer secret' } });
};

describe('/api/cron/bloodsucker', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    sweepMock.mockReset();
  });

  it('refuses a call without the cron secret and sweeps nothing', async () => {
    vi.stubEnv('CRON_SECRET', 'secret');

    const response = await GET(new NextRequest(URL_BASE));

    expect(response.status).toBe(401);
    expect(sweepMock).not.toHaveBeenCalled();
  });

  it('reports the leagues it closed', async () => {
    sweepMock.mockResolvedValue({
      checkedLeagueIds: ['league-1', 'league-2'],
      closedLeagueIds: ['league-2'],
      failedLeagueIds: [],
    });

    const response = await POST(authorised());

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      closedLeagueIds: ['league-2'],
      failedLeagueIds: [],
    });
  });

  it('answers 500 when any league fails, so the scheduler records a failed run', async () => {
    sweepMock.mockResolvedValue({
      checkedLeagueIds: ['league-1'],
      closedLeagueIds: [],
      failedLeagueIds: ['league-1'],
    });

    const response = await GET(authorised());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      failedLeagueIds: ['league-1'],
    });
  });

  it('answers 500 when the sweep itself throws', async () => {
    sweepMock.mockRejectedValue(new Error('database down'));

    const response = await GET(authorised());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Failed to sweep Bloodsucker windows',
    });
  });
});
