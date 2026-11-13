import { NextRequest } from 'next/server';

import { afterEach, describe, expect, it, vi } from 'vitest';

const windowsMock = vi.fn();
const bitesMock = vi.fn();
const monitorMock = vi.fn((_slug: string, run: () => Promise<Response>) => run());
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/cron/cronMonitors', () => ({
  monitorCronRun: (slug: string, run: () => Promise<Response>) => monitorMock(slug, run),
}));
vi.mock('@/server/leagues/bloodsuckerAutoFill', () => ({
  sweepBloodsuckerWindows: (...args: unknown[]) => windowsMock(...args),
}));
vi.mock('@/server/leagues/bloodsuckerAutoBite', () => ({
  sweepDueBloodsuckerBites: (...args: unknown[]) => bitesMock(...args),
}));

const { GET, POST } = await import('./route');

const URL_BASE = 'http://localhost/api/cron/bloodsucker';
const authorised = () => {
  vi.stubEnv('CRON_SECRET', 'secret');
  return new NextRequest(URL_BASE, { headers: { authorization: 'Bearer secret' } });
};
const windows = (failedLeagueIds: string[] = []) => ({
  checkedLeagueIds: ['league-1', 'league-2'],
  closedLeagueIds: ['league-2'],
  failedLeagueIds,
});
const bites = (failedLeagueIds: string[] = []) => ({
  autoExecutedBiteIds: ['bite-1'],
  waitingLockBiteIds: ['bite-2'],
  failedLeagueIds,
});

describe('/api/cron/bloodsucker', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    windowsMock.mockReset();
    bitesMock.mockReset();
    monitorMock.mockClear();
  });

  it('refuses a call without the cron secret, sweeps nothing and never checks in', async () => {
    vi.stubEnv('CRON_SECRET', 'secret');

    const response = await GET(new NextRequest(URL_BASE));

    expect(response.status).toBe(401);
    expect(windowsMock).not.toHaveBeenCalled();
    expect(bitesMock).not.toHaveBeenCalled();
    expect(monitorMock).not.toHaveBeenCalled();
  });

  it('closes windows, runs due bites and reports both under the cron-bloodsucker monitor', async () => {
    windowsMock.mockResolvedValue(windows());
    bitesMock.mockResolvedValue(bites());

    const response = await POST(authorised());

    expect(monitorMock).toHaveBeenCalledWith('cron-bloodsucker', expect.any(Function));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      closedLeagueIds: ['league-2'],
      autoExecutedBiteIds: ['bite-1'],
      waitingLockBiteIds: ['bite-2'],
      failedLeagueIds: [],
    });
    // Both sweeps see the same clock.
    expect(bitesMock.mock.calls[0]?.[0]).toEqual(windowsMock.mock.calls[0]?.[0]);
  });

  it.each([
    ['a window close', windows(['league-1']), bites()],
    ['an auto-bite', windows(), bites(['league-1'])],
  ])('answers 500 when %s fails, so the monitor records a failed run', async (_, w, b) => {
    windowsMock.mockResolvedValue(w);
    bitesMock.mockResolvedValue(b);

    const response = await GET(authorised());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      failedLeagueIds: ['league-1'],
    });
  });

  it('answers 500 when a sweep throws', async () => {
    windowsMock.mockResolvedValue(windows());
    bitesMock.mockRejectedValue(new Error('database down'));

    const response = await GET(authorised());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Failed to run the Bloodsucker sweep',
    });
  });
});
