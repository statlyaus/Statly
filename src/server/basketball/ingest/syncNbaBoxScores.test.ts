// @vitest-environment node
import { Prisma } from '@prisma/client';
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
    unidentifiedEmptyRows: 0,
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

interface PriorRun {
  startedAt: Date;
  skipped: Array<{ gameExternalId: string; reason: string }>;
}

/**
 * A database with `pending` FINAL games (g0, g1, …) waiting for their box score, earlier
 * BOX_SCORES runs, and, when `writes` is set, transactions that succeed unless `failWrite` throws.
 */
function pendingDatabase(
  pending: number,
  {
    priorRuns = [],
    writes = false,
    failWrite,
  }: { priorRuns?: PriorRun[]; writes?: boolean; failWrite?: (externalId: string) => void } = {}
) {
  const rows = Array.from({ length: pending }, (_, index) => ({
    id: `game-${index}`,
    externalId: `g${index}`,
    startsAt: new Date(Date.UTC(2026, 10, 1, index)),
  }));
  type GameWhere = { boxScoreIngestedAt?: unknown; externalId?: { notIn?: string[] } };
  type RunWhere = { startedAt: { gte: Date } };
  let created = 0;
  return fakeIngestPrisma(
    {
      nbaGame: {
        findMany: (async (args: { where: GameWhere }) =>
          args.where.boxScoreIngestedAt === null
            ? rows.filter((row) => !args.where.externalId?.notIn?.includes(row.externalId))
            : []) as never,
      },
      nbaTeam: {
        findMany: (async () => [
          { id: 'team-gsw', code: 'GSW' },
          { id: 'team-mia', code: 'MIA' },
        ]) as never,
      },
      nbaIngestRun: {
        findMany: (async (args: { where: RunWhere }) =>
          priorRuns
            .filter((run) => run.startedAt >= args.where.startedAt.gte)
            .map((run) => ({ summaryJson: { skipped: run.skipped } }))) as never,
      },
    },
    {
      transaction: writes
        ? (model, method, args: { where?: { provider_externalId?: { externalId: string } } }) => {
            if (model === 'nbaGame' && method === 'upsert') {
              const externalId = args.where?.provider_externalId?.externalId ?? '';
              failWrite?.(externalId);
              return { id: `game-${externalId}` };
            }
            if (method === 'findMany') return [];
            if (model === 'nbaPlayer' && method === 'create') return { id: `player-${++created}` };
            return { count: 0 };
          }
        : undefined,
    }
  );
}

/** The games whose player lines a run wrote, read from the recorded transaction calls. */
function writtenGames(calls: Array<{ model: string; method: string; args: unknown }>) {
  return calls
    .filter((call) => call.model === 'nbaPlayerGameStat' && call.method === 'createMany')
    .map((call) => (call.args as { data: Array<{ gameId: string }> }).data[0].gameId);
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

  it('skips a game that fails its check, writes the others and still succeeds', async () => {
    const { prisma, runs, transactionCalls } = pendingDatabase(3, { writes: true });
    const provider = fakeProvider({
      fetchScoreboard: async () => [],
      fetchBoxScore: async (id) =>
        id === 'g1' ? box(7, 10, { externalId: id }) : box(10, 10, { externalId: id }),
    });

    const { summary } = await syncNbaBoxScores({ prisma, provider, season: 2027, now: NOW });

    expect(summary).toMatchObject({ ingested: 2, skipped: [{ gameExternalId: 'g1' }] });
    expect(writtenGames(transactionCalls)).toEqual(['game-g0', 'game-g2']);
    expect(runs[0]).toMatchObject({ outcome: 'SUCCEEDED' });
  });

  it('records a unique-constraint clash from an overlapping run as concurrent_write', async () => {
    const { prisma, runs, transactionCalls } = pendingDatabase(3, {
      writes: true,
      failWrite: (externalId) => {
        if (externalId === 'g1') {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'test',
          });
        }
      },
    });
    const provider = fakeProvider({
      fetchScoreboard: async () => [],
      fetchBoxScore: async (id) => box(10, 10, { externalId: id }),
    });

    const { summary } = await syncNbaBoxScores({ prisma, provider, season: 2027, now: NOW });

    expect(summary).toMatchObject({
      ingested: 2,
      skipped: [{ gameExternalId: 'g1', reason: 'concurrent_write' }],
    });
    expect(writtenGames(transactionCalls)).toEqual(['game-g0', 'game-g2']);
    expect(runs[0]).toMatchObject({ outcome: 'SUCCEEDED' });
  });

  it('defers for 24 hours a game skipped by two runs, but retries a single or old failure', async () => {
    const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);
    const fails = { reason: 'parse_failed: bad row' };
    const { prisma } = pendingDatabase(4, {
      writes: true,
      priorRuns: [
        // g0 kept failing: deferred.
        { startedAt: hoursAgo(1), skipped: [{ gameExternalId: 'g0', ...fails }] },
        { startedAt: hoursAgo(2), skipped: [{ gameExternalId: 'g0', ...fails }] },
        // g1 failed once: retried.
        { startedAt: hoursAgo(1), skipped: [{ gameExternalId: 'g1', ...fails }] },
        // g2 failed twice, but more than 24 hours ago: retried.
        { startedAt: hoursAgo(25), skipped: [{ gameExternalId: 'g2', ...fails }] },
        { startedAt: hoursAgo(30), skipped: [{ gameExternalId: 'g2', ...fails }] },
        // g3 lost two write races: not a failing box score, retried.
        { startedAt: hoursAgo(1), skipped: [{ gameExternalId: 'g3', reason: 'concurrent_write' }] },
        { startedAt: hoursAgo(2), skipped: [{ gameExternalId: 'g3', reason: 'concurrent_write' }] },
      ],
    });
    const fetchBoxScore = vi.fn(async (id: string) => box(10, 10, { externalId: id }));
    const provider = fakeProvider({ fetchScoreboard: async () => [], fetchBoxScore });

    const { summary } = await syncNbaBoxScores({ prisma, provider, season: 2027, now: NOW });

    expect(fetchBoxScore.mock.calls.map(([id]) => id)).toEqual(['g1', 'g2', 'g3']);
    expect(summary).toMatchObject({ deferred: 1, ingested: 3 });
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
