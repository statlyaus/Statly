import { NextRequest } from 'next/server';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const jobMocks = vi.hoisted(() => ({
  boxscores: vi.fn(),
  schedule: vi.fn(),
  players: vi.fn(),
  injuries: vi.fn(),
}));
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));
const provider = vi.hoisted(() => ({ id: 'espn', commercialUseLicensed: false }));

vi.mock('@/lib/logger', () => ({ logger: loggerMock }));
vi.mock('@/lib/prisma', () => ({ prisma: { fake: true } }));
vi.mock('@/server/basketball/ingest/espn/espnClient', () => ({
  createEspnNbaStatsProvider: () => provider,
}));
vi.mock('@/server/basketball/ingest/nbaIngestJobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/basketball/ingest/nbaIngestJobs')>();
  return { ...actual, NBA_INGEST_JOBS: jobMocks };
});

const monitorCronRunMock = vi.hoisted(() =>
  vi.fn((_slug: string, run: () => Promise<Response>): Promise<Response> => run())
);
vi.mock('@/server/cron/cronMonitors', () => ({
  isCronMonitorSlug: (slug: string) => slug === 'cron-nba-boxscores',
  monitorCronRun: monitorCronRunMock,
}));

const { GET, POST } = await import('./route');
const { NbaIngestRejected } = await import('@/server/basketball/ingest/nbaStatsProvider');

const NOW = new Date('2026-11-08T12:00:00Z');

function request(query: string, secret = 'cron-secret', method = 'GET') {
  return new NextRequest(`http://localhost/api/cron/nba${query}`, {
    method,
    headers: { authorization: `Bearer ${secret}` },
  });
}

describe('/api/cron/nba', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    for (const job of Object.values(jobMocks)) {
      job.mockResolvedValue({ runId: 'run-1', summary: { ingested: 2 } });
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    monitorCronRunMock.mockClear();
  });

  it('checks the box score job in to its Sentry monitor', async () => {
    const response = await GET(request('?job=boxscores'));

    expect(response.status).toBe(200);
    expect(monitorCronRunMock).toHaveBeenCalledWith('cron-nba-boxscores', expect.any(Function));
  });

  it.each(['schedule', 'players', 'injuries'])(
    'runs the unmonitored %s job without a check-in',
    async (job) => {
      const response = await GET(request(`?job=${job}`));

      expect(response.status).toBe(200);
      expect(monitorCronRunMock).not.toHaveBeenCalled();
    }
  );

  it('does not check in an unauthorised call or an unknown job', async () => {
    await GET(request('?job=boxscores', 'wrong'));
    await GET(request('?job=nope'));

    expect(monitorCronRunMock).not.toHaveBeenCalled();
  });

  it.each(['GET', 'POST'])('rejects a wrong secret on %s without running a job', async (method) => {
    const handler = method === 'GET' ? GET : POST;

    const response = await handler(request('?job=boxscores', 'wrong', method));

    expect(response.status).toBe(401);
    expect(jobMocks.boxscores).not.toHaveBeenCalled();
  });

  it.each(['', '?job=backfill', '?job=toString'])(
    'answers 400 for job query "%s"',
    async (query) => {
      const response = await GET(request(query));

      expect(response.status).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(Object.values(jobMocks).some((job) => job.mock.calls.length > 0)).toBe(false);
    }
  );

  it.each(['boxscores', 'schedule', 'players', 'injuries'] as const)(
    'runs %s for the current season and is never cached',
    async (job) => {
      const response = await POST(request(`?job=${job}`, 'cron-secret', 'POST'));

      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      await expect(response.json()).resolves.toEqual({
        ok: true,
        job,
        runId: 'run-1',
        summary: { ingested: 2 },
      });
      expect(jobMocks[job]).toHaveBeenCalledWith({
        prisma: { fake: true },
        provider,
        season: 2027,
        now: NOW,
      });
    }
  );

  it('answers 422 with the reason when the run is rejected', async () => {
    jobMocks.injuries.mockRejectedValue(new NbaIngestRejected('out_of_bounds', '401 rows'));

    const response = await GET(request('?job=injuries'));

    expect(response.status).toBe(422);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      ok: false,
      job: 'injuries',
      reason: 'out_of_bounds',
      error: '401 rows',
    });
  });

  it('answers 500 on any other failure', async () => {
    jobMocks.schedule.mockRejectedValue(new Error('database down'));

    const response = await GET(request('?job=schedule'));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      job: 'schedule',
      error: 'NBA ingest failed',
    });
    expect(loggerMock.error).toHaveBeenCalledWith(
      'NBA ingest failed',
      expect.objectContaining({ job: 'schedule', error: 'database down' })
    );
  });
});
