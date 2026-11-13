import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthenticatedUserId: vi.fn(),
  getLiveMatchDataResult: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({ logger: { error: mocks.loggerError } }));
vi.mock('@/lib/serverAuth', () => ({ getAuthenticatedUserId: mocks.getAuthenticatedUserId }));
vi.mock('@/server/etl/etlRoundData', () => ({
  getLiveMatchDataResult: mocks.getLiveMatchDataResult,
}));

import { GET } from './route';

const request = () => GET(new NextRequest('http://localhost/api/matches/live'));

const liveMatch = {
  match_uid: '2026-R07-GEE-BRL',
  season: 2026,
  round_number: 7,
  home_team: 'Geelong',
  away_team: 'Brisbane Lions',
  start_time_utc: '2026-04-25T04:30:00.000Z',
  status: 'in_progress',
};
const stat = (player_uid: string, last_seen_at: string) => ({
  match_uid: liveMatch.match_uid,
  player_uid,
  team: 'Geelong',
  season: 2026,
  last_seen_at,
  stats: { goals: 2 },
});

describe('GET /api/matches/live', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUserId.mockResolvedValue('user-1');
    mocks.getLiveMatchDataResult.mockResolvedValue({
      ok: true,
      matches: [liveMatch],
      stats: [stat('ply_a', '2026-04-25T05:00:00.000Z'), stat('ply_b', '2026-04-25T05:10:00.000Z')],
    });
  });

  it('returns the live matches, their player stats and the newest stat time', async () => {
    const response = await request();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const { data } = await response.json();
    expect(data.matches).toEqual([liveMatch]);
    expect(data.stats.map((row: { player_uid: string }) => row.player_uid)).toEqual([
      'ply_a',
      'ply_b',
    ]);
    expect(data.lastUpdate).toBe('2026-04-25T05:10:00.000Z');
  });

  it('answers with no stats and no update time when no game is live', async () => {
    mocks.getLiveMatchDataResult.mockResolvedValue({ ok: true, matches: [], stats: [] });

    const { data } = await (await request()).json();

    expect(data).toEqual({ matches: [], stats: [], lastUpdate: null });
  });

  it('refuses a signed-out caller before reading anything', async () => {
    mocks.getAuthenticatedUserId.mockResolvedValue(null);

    const response = await request();

    expect(response.status).toBe(401);
    expect(mocks.getLiveMatchDataResult).not.toHaveBeenCalled();
  });

  it('fails closed when the live data cannot be read', async () => {
    mocks.getLiveMatchDataResult.mockResolvedValue({ ok: false, error: new Error('down') });

    const response = await request();

    expect(response.status).toBe(500);
    expect(mocks.loggerError).toHaveBeenCalled();
  });
});
