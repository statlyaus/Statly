import { NextRequest } from 'next/server';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readMissingAflResultsMock = vi.fn();
const loggerMock = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/logger', () => ({ logger: loggerMock }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/server/etl/missingAflResults', () => ({
  readFixtureGamesStartedBetween: vi.fn(),
  readMissingAflResults: (...args: unknown[]) => readMissingAflResultsMock(...args),
}));

const { GET, POST } = await import('./route');

const URL_BASE = 'http://localhost/api/cron/afl-results';
const MISSING = {
  match_uid: '2025-R28-GEE-BRL',
  season: 2025,
  round_number: 28,
  home_team: 'Geelong',
  away_team: 'Brisbane Lions',
  start_time_utc: '2025-09-27T04:30:00.000Z',
};

function authorized() {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('CRON_SECRET', 'cron-secret');
  return new NextRequest(URL_BASE, { headers: { authorization: 'Bearer cron-secret' } });
}

describe('/api/cron/afl-results', () => {
  beforeEach(() => {
    readMissingAflResultsMock.mockResolvedValue({ checked: 9, missing: [] });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('refuses an unauthorised call without checking', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    const response = await GET(new NextRequest(URL_BASE));
    expect(response.status).toBe(401);
    expect(readMissingAflResultsMock).not.toHaveBeenCalled();
  });

  it('answers 200 when every due game has a result', async () => {
    const response = await GET(authorized());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, checked: 9, missing: [] });
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it('logs each missing result as an error (forwarded to Sentry) and answers 500', async () => {
    readMissingAflResultsMock.mockResolvedValue({ checked: 9, missing: [MISSING] });

    const response = await POST(authorized());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, checked: 9, missing: [MISSING.match_uid] });
    expect(loggerMock.error).toHaveBeenCalledWith(
      'Missing AFL result: Geelong v Brisbane Lions (2025-R28-GEE-BRL) has no result 6 hours after its scheduled end',
      { matchUid: MISSING.match_uid, startTimeUtc: MISSING.start_time_utc }
    );
  });

  it('answers 500 when the check itself fails', async () => {
    readMissingAflResultsMock.mockRejectedValue(new Error('Firestore unavailable'));
    const response = await GET(authorized());
    expect(response.status).toBe(500);
    expect(loggerMock.error).toHaveBeenCalledWith('Failed to check for missing AFL results', {
      error: 'Firestore unavailable',
    });
  });
});
