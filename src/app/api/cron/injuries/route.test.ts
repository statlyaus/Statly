import { NextRequest } from 'next/server';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ingestFootywireInjuryListMock = vi.fn();
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/logger', () => ({ logger: loggerMock }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

vi.mock('@/server/injuries/injuryListIngestion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/injuries/injuryListIngestion')>();
  return {
    InjuryListIngestionRejected: actual.InjuryListIngestionRejected,
    ingestFootywireInjuryList: (...args: unknown[]) => ingestFootywireInjuryListMock(...args),
  };
});

const { GET, POST } = await import('./route');
const { InjuryListIngestionRejected } = await import('@/server/injuries/injuryListIngestion');

const URL_BASE = 'http://localhost/api/cron/injuries';
const COUNTS = { rows: 8, matched: 6, unmatched: 1, ambiguous: 1 };
// In season: the fetch runs 1 January to 7 October, Melbourne time.
const IN_SEASON = new Date('2026-06-15T02:00:00Z');

function authorized() {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('CRON_SECRET', 'cron-secret');
  return new NextRequest(URL_BASE, { headers: { authorization: 'Bearer cron-secret' } });
}

describe('/api/cron/injuries', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(IN_SEASON);
    ingestFootywireInjuryListMock.mockResolvedValue({
      outcome: 'created',
      snapshotId: 'snapshot-1',
      counts: COUNTS,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    ingestFootywireInjuryListMock.mockReset();
    loggerMock.info.mockReset();
    loggerMock.error.mockReset();
  });

  it('rejects every request when CRON_SECRET is unset outside development', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', '');

    const response = await GET(
      new NextRequest(URL_BASE, { headers: { authorization: 'Bearer anything' } })
    );

    expect(response.status).toBe(401);
    expect(ingestFootywireInjuryListMock).not.toHaveBeenCalled();
  });

  it.each(['GET', 'POST'] as const)('rejects a wrong secret on %s', async (method) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    const handler = method === 'GET' ? GET : POST;

    const response = await handler(
      new NextRequest(URL_BASE, { method, headers: { authorization: 'Bearer wrong-secret' } })
    );

    expect(response.status).toBe(401);
    expect(ingestFootywireInjuryListMock).not.toHaveBeenCalled();
  });

  it('ingests with the correct secret and is never cached', async () => {
    const response = await GET(authorized());

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      outcome: 'created',
      snapshotId: 'snapshot-1',
      counts: COUNTS,
    });
    expect(typeof body.checkedAt).toBe('string');
    expect(ingestFootywireInjuryListMock).toHaveBeenCalledTimes(1);
  });

  it('skips the fetch out of season and writes nothing', async () => {
    vi.setSystemTime(new Date('2026-11-20T00:00:00Z'));

    const response = await GET(authorized());

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      ok: true,
      skipped: 'off-season',
      checkedAt: '2026-11-20T00:00:00.000Z',
    });
    expect(ingestFootywireInjuryListMock).not.toHaveBeenCalled();
  });

  it('answers 500 with the reason when ingestion is rejected', async () => {
    ingestFootywireInjuryListMock.mockRejectedValue(
      new InjuryListIngestionRejected('too_many_rows', 'Footywire injury list has 601 rows')
    );

    const response = await GET(authorized());

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Injury list ingestion rejected: too_many_rows',
    });
    expect(loggerMock.error).toHaveBeenCalledWith(
      'Injury list ingestion rejected',
      expect.objectContaining({ reason: 'too_many_rows' })
    );
  });

  it('answers 500 on any other error', async () => {
    ingestFootywireInjuryListMock.mockRejectedValue(new Error('database down'));

    const response = await POST(authorized());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Failed to ingest the injury list',
    });
    expect(loggerMock.error).toHaveBeenCalledWith(
      'Failed to ingest the injury list',
      expect.objectContaining({ error: 'database down' })
    );
  });
});
