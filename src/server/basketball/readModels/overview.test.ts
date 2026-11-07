import { describe, expect, it } from 'vitest';

import type { BasketballLeagueDetail } from '@/server/basketball/leagues/basketballLeagueDto';
import { YAHOO_DEFAULT_ROSTER_SLOTS } from '@/types/basketball';

import { loadBasketballOverview, type OverviewClient } from './overview';

// Wednesday 4 Nov 2026, noon US Eastern: week 3 (Mon 2 – Sun 8 Nov) of a league starting 19 Oct.
const NOW = new Date('2026-11-04T17:00:00.000Z');

type Game = {
  season: number;
  gameDate: string;
  homeTeamId: string;
  awayTeamId: string;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'FINAL' | 'POSTPONED' | 'CANCELLED';
};
type Run = { job: 'BOX_SCORES' | 'INJURIES'; outcome: 'SUCCEEDED' | 'FAILED'; finishedAt: Date };

function spot(playerId: string, teamId: string | null, onInjuredList = false) {
  return {
    playerId,
    teamId,
    onInjuredList,
    acquiredOn: '2026-11-02',
    player: {
      fullName: `Player ${playerId}`,
      teamCode: null,
      positions: ['G'],
      active: true,
      injury:
        playerId === 'p-out'
          ? { status: 'OUT' as const, detail: 'Ankle', expectedReturnOn: '2026-11-20' }
          : null,
    },
  };
}

function league(overrides: Partial<BasketballLeagueDetail> = {}): BasketballLeagueDetail {
  return {
    id: 'league-1',
    name: 'Hoops',
    platform: 'YAHOO',
    format: 'H2H_MOST_CATEGORIES',
    season: 2027,
    categories: ['PTS', 'REB'],
    puntCategories: [],
    teamCount: 12,
    rosterSlots: YAHOO_DEFAULT_ROSTER_SLOTS,
    weekOneStartsOn: '2026-10-19',
    regularSeasonEndsOn: '2027-04-11',
    twoWeekMatchups: [],
    auctionBudget: null,
    myTeamId: 'mine',
    teams: [
      { id: 'mine', name: 'My Team', isMine: true, sortOrder: 0 },
      { id: 'opp', name: 'Rival', isMine: false, sortOrder: 1 },
    ],
    rosterSpots: [
      spot('p-bos', 'mine'),
      spot('p-out', 'mine'),
      spot('p-il', 'mine', true),
      spot('p-nyk', 'opp'),
      spot('p-elsewhere', null),
    ],
    matchups: [
      { week: 2, teamId: 'mine', opponentTeamId: 'mine-old' },
      { week: 3, teamId: 'mine', opponentTeamId: 'opp' },
    ],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

const NBA_TEAM_BY_PLAYER: Record<string, string | null> = {
  'p-bos': 'BOS',
  'p-out': 'BOS',
  'p-il': 'NYK',
  'p-nyk': 'NYK',
  'p-elsewhere': 'DEN',
};

const WEEK_GAMES: Game[] = [
  // Monday and Tuesday are played.
  { season: 2027, gameDate: '2026-11-02', homeTeamId: 'BOS', awayTeamId: 'NYK', status: 'FINAL' },
  { season: 2027, gameDate: '2026-11-03', homeTeamId: 'DEN', awayTeamId: 'BOS', status: 'FINAL' },
  // Today: one in progress, one still to start.
  {
    season: 2027,
    gameDate: '2026-11-04',
    homeTeamId: 'BOS',
    awayTeamId: 'LAL',
    status: 'IN_PROGRESS',
  },
  {
    season: 2027,
    gameDate: '2026-11-04',
    homeTeamId: 'NYK',
    awayTeamId: 'DEN',
    status: 'SCHEDULED',
  },
  // Later this week, plus one postponed game that does not count.
  {
    season: 2027,
    gameDate: '2026-11-07',
    homeTeamId: 'NYK',
    awayTeamId: 'BOS',
    status: 'SCHEDULED',
  },
  {
    season: 2027,
    gameDate: '2026-11-08',
    homeTeamId: 'LAL',
    awayTeamId: 'NYK',
    status: 'POSTPONED',
  },
  // Outside the week, or another season: never counted.
  {
    season: 2027,
    gameDate: '2026-11-09',
    homeTeamId: 'BOS',
    awayTeamId: 'NYK',
    status: 'SCHEDULED',
  },
  {
    season: 2026,
    gameDate: '2026-11-05',
    homeTeamId: 'BOS',
    awayTeamId: 'NYK',
    status: 'SCHEDULED',
  },
];

function fakeClient(games: Game[] = WEEK_GAMES, runs: Run[] = []): OverviewClient {
  const client = {
    nbaPlayer: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({ id, teamId: NBA_TEAM_BY_PLAYER[id] ?? null })),
    },
    nbaGame: {
      findMany: async ({
        where,
      }: {
        where: {
          season: number;
          gameDate: { gte: Date; lte: Date };
          OR: [{ homeTeamId: { in: string[] } }, { awayTeamId: { in: string[] } }];
        };
      }) => {
        const teams = new Set(where.OR[0].homeTeamId.in);
        return games
          .filter(
            (game) =>
              game.season === where.season &&
              new Date(`${game.gameDate}T00:00:00.000Z`) >= where.gameDate.gte &&
              new Date(`${game.gameDate}T00:00:00.000Z`) <= where.gameDate.lte &&
              (teams.has(game.homeTeamId) || teams.has(game.awayTeamId))
          )
          .map((game) => ({ ...game, gameDate: new Date(`${game.gameDate}T00:00:00.000Z`) }));
      },
    },
    nbaIngestRun: {
      findFirst: async ({ where }: { where: { job: Run['job']; outcome: 'SUCCEEDED' } }) => {
        const latest = runs
          .filter((run) => run.job === where.job && run.outcome === where.outcome)
          .sort((left, right) => right.finishedAt.getTime() - left.finishedAt.getTime())[0];
        return latest ? { finishedAt: latest.finishedAt } : null;
      },
    },
  };
  return client as unknown as OverviewClient;
}

describe('loadBasketballOverview', () => {
  it("counts each player's games this week and the games still to finish from today", async () => {
    const overview = await loadBasketballOverview(league(), { prisma: fakeClient(), now: NOW });

    expect(overview.today).toBe('2026-11-04');
    expect(overview.phase).toBe('IN_SEASON');
    expect(overview.week).toMatchObject({ week: 3, start: '2026-11-02', end: '2026-11-08' });

    const games = (side: typeof overview.me | null) =>
      side?.players.map(({ playerId, gamesThisWeek, gamesLeft }) => ({
        playerId,
        gamesThisWeek,
        gamesLeft,
      }));
    // BOS plays Mon, Tue, today (in progress) and Sat: 4 this week, 2 left.
    // NYK plays Mon, today and Sat (Sunday's game is postponed): 3 this week, 2 left.
    expect(games(overview.me)).toEqual([
      { playerId: 'p-bos', gamesThisWeek: 4, gamesLeft: 2 },
      { playerId: 'p-out', gamesThisWeek: 4, gamesLeft: 2 },
      { playerId: 'p-il', gamesThisWeek: 3, gamesLeft: 2 },
    ]);
    expect(games(overview.opponent)).toEqual([
      { playerId: 'p-nyk', gamesThisWeek: 3, gamesLeft: 2 },
    ]);
  });

  it("names this week's opponent", async () => {
    const overview = await loadBasketballOverview(league(), { prisma: fakeClient(), now: NOW });

    expect(overview.me).toMatchObject({ teamId: 'mine', name: 'My Team' });
    expect(overview.opponent).toMatchObject({ teamId: 'opp', name: 'Rival', gamesLeft: 2 });
  });

  it("leaves injured-list and ruled-out players out of the team's games left, but keeps their rows", async () => {
    const overview = await loadBasketballOverview(league(), { prisma: fakeClient(), now: NOW });

    // p-bos has 2 left; p-out (OUT on the injury report) and p-il (on the injured list) have 2 each
    // but are not counted.
    expect(overview.me.gamesLeft).toBe(2);
    const counted = Object.fromEntries(
      overview.me.players.map((player) => [player.playerId, player.counted])
    );
    expect(counted).toEqual({ 'p-bos': true, 'p-out': false, 'p-il': false });
    expect(overview.me.players.find((player) => player.playerId === 'p-out')).toMatchObject({
      gamesLeft: 2,
      injury: { status: 'OUT', detail: 'Ankle', expectedReturnOn: '2026-11-20' },
    });
  });

  it('has no opponent when none is set for this week', async () => {
    const overview = await loadBasketballOverview(league({ matchups: [] }), {
      prisma: fakeClient(),
      now: NOW,
    });

    expect(overview.opponent).toBeNull();
  });

  it('reports when NBA stats and the injury report were last updated, and whether that is stale', async () => {
    const runs: Run[] = [
      { job: 'BOX_SCORES', outcome: 'SUCCEEDED', finishedAt: new Date('2026-11-04T14:00:00Z') },
      { job: 'BOX_SCORES', outcome: 'FAILED', finishedAt: new Date('2026-11-04T16:30:00Z') },
      { job: 'INJURIES', outcome: 'SUCCEEDED', finishedAt: new Date('2026-11-03T12:00:00Z') },
    ];
    const overview = await loadBasketballOverview(league(), {
      prisma: fakeClient(WEEK_GAMES, runs),
      now: NOW,
    });

    expect(overview.stats).toEqual({ updatedAt: '2026-11-04T14:00:00.000Z', stale: false });
    expect(overview.injuryReport).toEqual({ updatedAt: '2026-11-03T12:00:00.000Z', stale: true });
  });

  it('says stats have never been loaded when no box-score run has succeeded', async () => {
    const overview = await loadBasketballOverview(league(), { prisma: fakeClient([]), now: NOW });

    expect(overview.stats).toEqual({ updatedAt: null, stale: true });
    expect(overview.me.players.every((player) => player.gamesThisWeek === 0)).toBe(true);
  });

  it('shows week one before the season starts and the last week after it ends', async () => {
    const before = await loadBasketballOverview(league(), {
      prisma: fakeClient([]),
      now: new Date('2026-10-10T17:00:00Z'),
    });
    const after = await loadBasketballOverview(league(), {
      prisma: fakeClient([]),
      now: new Date('2027-05-01T17:00:00Z'),
    });

    expect(before).toMatchObject({ phase: 'PRESEASON', week: { week: 1, start: '2026-10-19' } });
    expect(after).toMatchObject({ phase: 'ENDED', week: { week: 25, start: '2027-04-05' } });
  });
});
