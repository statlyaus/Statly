// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { fakeIngestPrisma, fakeProvider } from './__fixtures__/fakes';
import type {
  NbaProviderBoxScore,
  NbaProviderGame,
  NbaProviderPlayerLine,
} from './nbaStatsProvider';
import { NbaIngestRejected } from './nbaStatsProvider';
import { boxScoreProblem, syncNbaBoxScores } from './syncNbaBoxScores';

const NOW = new Date('2026-11-08T12:00:00Z');

function line(externalId: string, teamCode: string): NbaProviderPlayerLine {
  return {
    player: { externalId, fullName: `Player ${externalId}`, positions: ['G'] },
    teamCode,
    starter: false,
    played: true,
    dnpReason: null,
    secondsPlayed: 600,
    points: 7,
    rebounds: 4,
    offensiveRebounds: 1,
    defensiveRebounds: 3,
    assists: 2,
    steals: 1,
    blocks: 0,
    turnovers: 1,
    fieldGoalsMade: 3,
    fieldGoalsAttempted: 5,
    threePointersMade: 1,
    threePointersAttempted: 2,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    personalFouls: 2,
    plusMinus: 3,
  };
}

function box(
  home = 10,
  away = 10,
  overrides: Partial<NbaProviderBoxScore['game']> = {}
): NbaProviderBoxScore {
  return {
    game: {
      externalId: 'g1',
      season: 2027,
      startsAt: new Date('2026-11-06T03:00:00Z'),
      gameDate: '2026-11-05',
      homeTeamCode: 'GSW',
      awayTeamCode: 'MIA',
      status: 'FINAL',
      homeScore: 120,
      awayScore: 100,
      ...overrides,
    },
    lines: [
      ...Array.from({ length: home }, (_, index) => line(`h${index}`, 'GSW')),
      ...Array.from({ length: away }, (_, index) => line(`a${index}`, 'MIA')),
    ],
    unidentifiedDidNotPlay: 0,
  };
}

describe('boxScoreProblem', () => {
  it('accepts a final box score with both teams and 8 to 20 players each', () => {
    expect(boxScoreProblem(box(8, 20), 'g1', 2027)).toBeNull();
  });

  it.each([
    ['a team lists fewer than 8 players', box(7, 10), /GSW lists 7/],
    ['a team lists more than 20 players', box(10, 21), /MIA lists 21/],
    ['a team is missing', box(10, 0), /teams/],
    ['the game is not final', box(10, 10, { status: 'IN_PROGRESS' }), /not FINAL/],
    ['the summary is for another game', box(10, 10, { externalId: 'g2' }), /g2/],
    ['the game is in another season', box(10, 10, { season: 2026 }), /season 2026/],
  ])('reports when %s', (_label, candidate, message) => {
    expect(boxScoreProblem(candidate, 'g1', 2027)).toMatch(message);
  });

  it('reports a player listed twice', () => {
    const twice = box();
    twice.lines.push(line('h0', 'GSW'));
    expect(boxScoreProblem(twice, 'g1', 2027)).toMatch(/twice/);
  });
});

/** A database with `pending` FINAL games waiting for their box score. */
function pendingDatabase(pending: number) {
  const rows = Array.from({ length: pending }, (_, index) => ({
    id: `game-${index}`,
    externalId: `g${index}`,
    startsAt: new Date(Date.UTC(2026, 10, 1, index)),
  }));
  return fakeIngestPrisma({
    nbaGame: {
      findMany: (async (args: { where: { boxScoreIngestedAt?: unknown } }) =>
        args.where.boxScoreIngestedAt === null ? rows : []) as never,
    },
  });
}

async function rejected(run: Promise<unknown>) {
  const error = await run.then(
    () => undefined,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(NbaIngestRejected);
  return error as NbaIngestRejected;
}

describe('syncNbaBoxScores', () => {
  it('rejects a scoreboard fetch failure and writes only the run row', async () => {
    const { prisma, runs, forbiddenWrites } = pendingDatabase(3);
    const fetchBoxScore = vi.fn();
    const provider = fakeProvider({
      fetchScoreboard: async () => {
        throw new NbaIngestRejected('fetch_failed', 'scoreboard answered 503');
      },
      fetchBoxScore,
    });

    const error = await rejected(syncNbaBoxScores({ prisma, provider, season: 2027, now: NOW }));

    expect(error.reason).toBe('fetch_failed');
    expect(fetchBoxScore).not.toHaveBeenCalled();
    expect(forbiddenWrites).toEqual([]);
    expect(runs).toEqual([expect.objectContaining({ job: 'BOX_SCORES', outcome: 'REJECTED' })]);
  });

  it('asks for yesterday and today on the Eastern calendar', async () => {
    const { prisma } = pendingDatabase(0);
    const fetchScoreboard = vi.fn(async (_date: string): Promise<NbaProviderGame[]> => []);

    await syncNbaBoxScores({
      prisma,
      provider: fakeProvider({ fetchScoreboard }),
      season: 2027,
      now: NOW,
    });

    // 12:00 UTC on 8 November is 7 am Eastern.
    expect(fetchScoreboard.mock.calls.map(([date]) => date)).toEqual(['2026-11-07', '2026-11-08']);
  });

  it('fetches at most the game limit and rejects when every fetch fails', async () => {
    const { prisma, forbiddenWrites } = pendingDatabase(20);
    const fetchBoxScore = vi.fn(async (_externalId: string): Promise<NbaProviderBoxScore> => {
      throw new NbaIngestRejected('fetch_failed', 'summary answered 500', { httpStatus: 500 });
    });
    const provider = fakeProvider({ fetchScoreboard: async () => [], fetchBoxScore });

    const error = await rejected(
      syncNbaBoxScores({ prisma, provider, season: 2027, now: NOW, limits: { games: 5 } })
    );

    expect(error.reason).toBe('fetch_failed');
    expect(fetchBoxScore).toHaveBeenCalledTimes(5);
    expect(fetchBoxScore.mock.calls.map(([id]) => id)).toEqual(['g0', 'g1', 'g2', 'g3', 'g4']);
    expect(forbiddenWrites).toEqual([]);
  });

  it.each([403, 429])(
    'stops the whole run when ESPN answers %s, writing nothing',
    async (status) => {
      const { prisma, forbiddenWrites } = pendingDatabase(3);
      const provider = fakeProvider({
        fetchScoreboard: async () => [],
        fetchBoxScore: async (id) => {
          if (id === 'g1') {
            throw new NbaIngestRejected('fetch_failed', `answered ${status}`, {
              httpStatus: status,
            });
          }
          return box(10, 10, { externalId: id });
        },
      });

      const error = await rejected(syncNbaBoxScores({ prisma, provider, season: 2027, now: NOW }));

      expect(error.httpStatus).toBe(status);
      expect(forbiddenWrites).toEqual([]);
    }
  );
});
