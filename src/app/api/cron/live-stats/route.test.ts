import { NextRequest } from 'next/server';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const refreshLiveStatsIfNeededMock = vi.fn();

vi.mock('@/lib/liveStatsRefresh', () => ({
  refreshLiveStatsIfNeeded: refreshLiveStatsIfNeededMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('GET /api/cron/live-stats', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('STATLY_RUNTIME_ENV', 'preview');
    delete process.env.CRON_SECRET;
  });

  it('rejects requests without a configured cron secret outside explicit local runtime', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const { GET } = await import('./route');

    const response = await GET(new NextRequest('http://localhost/api/cron/live-stats'));

    expect(response.status).toBe(401);
    expect(refreshLiveStatsIfNeededMock).not.toHaveBeenCalled();
  });

  it('rejects unauthorized requests when CRON_SECRET is configured', async () => {
    process.env.CRON_SECRET = 'top-secret';
    const { GET } = await import('./route');

    const response = await GET(new NextRequest('http://localhost/api/cron/live-stats'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
  });

  it('runs the live refresh and returns the result for authorized requests', async () => {
    process.env.CRON_SECRET = 'top-secret';
    refreshLiveStatsIfNeededMock.mockResolvedValue({
      refreshed: true,
      season: 2026,
      rounds: [1],
      liveMatchCount: 1,
      reason: 'refreshed',
    });

    const { GET } = await import('./route');

    const response = await GET(
      new NextRequest('http://localhost/api/cron/live-stats', {
        headers: {
          authorization: 'Bearer top-secret',
        },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(refreshLiveStatsIfNeededMock).toHaveBeenCalledWith({
      minIntervalMs: 30_000,
      trigger: 'cron',
    });
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      refreshed: true,
      season: 2026,
      rounds: [1],
      liveMatchCount: 1,
    });
  });
});
