import { NextRequest } from 'next/server';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findManyMock = vi.fn();
const recalculateMock = vi.fn();
const loggerErrorMock = vi.fn();

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: (...args: unknown[]) => loggerErrorMock(...args) },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { leagueCompetitionRound: { findMany: (...args: unknown[]) => findManyMock(...args) } },
}));

vi.mock('@/server/leagues/matchupReadModel', () => ({
  recalculateLeagueRoundMatchups: (...args: unknown[]) => recalculateMock(...args),
}));

const { GET, POST } = await import('./route');

const URL_BASE = 'http://localhost/api/cron/scoring';
const authorized = () =>
  new NextRequest(URL_BASE, { headers: { authorization: 'Bearer cron-secret' } });

function startedRound(leagueId: string, round: number, fixtureVersion = 1, published = 1) {
  return {
    leagueId,
    round,
    fixtureVersion,
    league: { settings: { competitionRulesVersion: published } },
  };
}

function recalculated(round: number, status: 'LIVE' | 'FINAL' = 'LIVE') {
  return { round, status, recalculated: 2, scores: [], roundStatus: {} };
}

describe('/api/cron/scoring', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    findManyMock.mockResolvedValue([]);
    recalculateMock.mockImplementation(async ({ round }: { round: number }) => recalculated(round));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    findManyMock.mockReset();
    recalculateMock.mockReset();
    loggerErrorMock.mockReset();
  });

  it('rejects every request when CRON_SECRET is unset outside development', async () => {
    vi.stubEnv('CRON_SECRET', '');

    const response = await GET(
      new NextRequest(URL_BASE, { headers: { authorization: 'Bearer anything' } })
    );

    expect(response.status).toBe(401);
    expect(findManyMock).not.toHaveBeenCalled();
    expect(recalculateMock).not.toHaveBeenCalled();
  });

  it.each(['GET', 'POST'] as const)('rejects a wrong secret on %s', async (method) => {
    const handler = method === 'GET' ? GET : POST;

    const response = await handler(
      new NextRequest(URL_BASE, { method, headers: { authorization: 'Bearer wrong-secret' } })
    );

    expect(response.status).toBe(401);
    expect(findManyMock).not.toHaveBeenCalled();
    expect(recalculateMock).not.toHaveBeenCalled();
  });

  it('looks only at started rounds that are not final in published competitions', async () => {
    const response = await GET(authorized());

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({ ok: true, leagues: [] });
    // The first read looks for rounds still waiting for a start time; the last one picks the rounds to score.
    const [query] = findManyMock.mock.calls.at(-1) as [
      { where: { status: unknown; startsAt: { lte: Date }; league: unknown } },
    ];
    expect(query.where.status).toEqual({ notIn: ['FINAL', 'NO_MATCHUP'] });
    expect(query.where.startsAt.lte).toBeInstanceOf(Date);
    expect(query.where.league).toEqual({
      settings: { competitionRulesVersion: { gt: 0 }, competitionStatus: { not: 'SETUP' } },
    });
  });

  it('recalculates each started round in order without forcing finalization', async () => {
    findManyMock.mockResolvedValue([
      startedRound('league-a', 1),
      startedRound('league-a', 2),
      startedRound('league-b', 1, 3, 3),
    ]);
    recalculateMock.mockImplementation(async ({ round }: { round: number }) =>
      recalculated(round, round === 1 ? 'FINAL' : 'LIVE')
    );

    const response = await GET(authorized());

    expect(response.status).toBe(200);
    expect(recalculateMock.mock.calls.map(([call]) => call)).toEqual([
      { leagueId: 'league-a', round: 1, finalize: false },
      { leagueId: 'league-a', round: 2, finalize: false },
      { leagueId: 'league-b', round: 1, finalize: false },
    ]);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      failedLeagueIds: [],
      leagues: [
        {
          leagueId: 'league-a',
          rounds: [
            { round: 1, status: 'FINAL', recalculated: 2 },
            { round: 2, status: 'LIVE', recalculated: 2 },
          ],
        },
        { leagueId: 'league-b', rounds: [{ round: 1, status: 'FINAL', recalculated: 2 }] },
      ],
    });
  });

  it('skips rounds left over from an earlier fixture version', async () => {
    findManyMock.mockResolvedValue([startedRound('league-a', 1, 1, 2)]);

    const response = await GET(authorized());

    expect(response.status).toBe(200);
    expect(recalculateMock).not.toHaveBeenCalled();
  });

  it('keeps scoring other leagues when one fails, then reports the failure', async () => {
    findManyMock.mockResolvedValue([
      startedRound('league-a', 1),
      startedRound('league-a', 2),
      startedRound('league-b', 1),
    ]);
    recalculateMock.mockImplementation(async ({ leagueId, round }) => {
      if (leagueId === 'league-a') throw new Error('stats unavailable');
      return recalculated(round);
    });

    const response = await GET(authorized());

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    // League A stops at its failed round; league B is still scored.
    expect(recalculateMock.mock.calls.map(([call]) => call)).toEqual([
      { leagueId: 'league-a', round: 1, finalize: false },
      { leagueId: 'league-b', round: 1, finalize: false },
    ]);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      failedLeagueIds: ['league-a'],
      leagues: [
        { leagueId: 'league-a', rounds: [], error: 'stats unavailable' },
        { leagueId: 'league-b', rounds: [{ round: 1, status: 'LIVE' }] },
      ],
    });
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Scheduled round scoring failed for a league',
      expect.objectContaining({ leagueId: 'league-a', round: 1, error: 'stats unavailable' })
    );
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'Scheduled round scoring failed',
      expect.objectContaining({ failedLeagueIds: ['league-a'] })
    );
  });

  it('reports a round the scoring service refuses as a league failure', async () => {
    findManyMock.mockResolvedValue([startedRound('league-a', 4), startedRound('league-a', 5)]);
    recalculateMock.mockResolvedValue({
      round: 4,
      status: 'FINAL',
      recalculated: 0,
      scores: [],
      blocked: 'UNSCORED_MATCHUP_IN_FINAL_ROUND',
      unscoredMatchupIds: ['matchup-1'],
      roundStatus: {},
    });

    const response = await GET(authorized());

    expect(response.status).toBe(500);
    expect(recalculateMock).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      failedLeagueIds: ['league-a'],
      leagues: [{ leagueId: 'league-a', error: 'UNSCORED_MATCHUP_IN_FINAL_ROUND' }],
    });
  });

  it('returns 500 when the started rounds cannot be read', async () => {
    findManyMock.mockRejectedValue(new Error('database down'));

    const response = await GET(authorized());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
    expect(recalculateMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalled();
  });
});
