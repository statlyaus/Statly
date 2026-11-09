import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthenticatedUserId: vi.fn(),
  getRoundMatchesResult: vi.fn(),
  loggerError: vi.fn(),
}));

// The route reads the fixture the ETL writes to `matches`; the retired MatchEvent collection
// must never be read again.
vi.mock('@/lib/firebaseAdmin', () => ({
  get adminDb() {
    throw new Error('The matches route must read the fixture through etlRoundData');
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.loggerError } }));
vi.mock('@/lib/serverAuth', () => ({ getAuthenticatedUserId: mocks.getAuthenticatedUserId }));
vi.mock('@/server/etl/etlRoundData', () => ({
  getRoundMatchesResult: mocks.getRoundMatchesResult,
}));

import { GET } from './route';

function request(query: string) {
  return GET(new NextRequest(`http://localhost/api/matches?${query}`));
}

const grandFinal = {
  match_uid: '2025-R28-GEE-BRL',
  season: 2025,
  round_number: 28,
  home_team: 'Geelong',
  away_team: 'Brisbane Lions',
  start_time_utc: '2025-09-27T04:30:00.000Z',
  status: 'final',
};

describe('GET /api/matches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.getAuthenticatedUserId.mockResolvedValue('user-1');
    mocks.getRoundMatchesResult.mockResolvedValue({ ok: true, matches: [grandFinal] });
  });

  it('returns the fixture matches the ETL wrote for the season and round', async () => {
    const response = await request('season=2025&round=28');

    expect(response.status).toBe(200);
    expect(mocks.getRoundMatchesResult).toHaveBeenCalledWith(2025, 28);
    expect((await response.json()).data).toEqual([
      {
        id: '2025-R28-GEE-BRL',
        matchDate: '2025-09-27T04:30:00.000Z',
        homeTeam: 'Geelong',
        awayTeam: 'Brisbane Lions',
        scoreHome: null,
        scoreAway: null,
        round: 28,
        status: 'final',
      },
    ]);
  });

  it("defaults to this year's season in Melbourne", async () => {
    vi.useFakeTimers({ now: new Date('2026-12-31T14:00:00.000Z'), toFake: ['Date'] });

    await request('round=0');

    expect(mocks.getRoundMatchesResult).toHaveBeenCalledWith(2027, 0);
  });

  it('refuses a signed-out caller before reading the fixture', async () => {
    mocks.getAuthenticatedUserId.mockResolvedValue(null);

    const response = await request('round=1');

    expect(response.status).toBe(401);
    expect(mocks.getRoundMatchesResult).not.toHaveBeenCalled();
  });

  it('rejects an invalid round or season', async () => {
    expect((await request('round=-1')).status).toBe(400);
    expect((await request('round=abc')).status).toBe(400);
    expect((await request('round=1&season=20x5')).status).toBe(400);
    expect(mocks.getRoundMatchesResult).not.toHaveBeenCalled();
  });

  it('fails closed when the fixture cannot be read', async () => {
    mocks.getRoundMatchesResult.mockResolvedValue({ ok: false, error: new Error('down') });

    const response = await request('season=2025&round=1');

    expect(response.status).toBe(500);
  });
});
