import { describe, expect, it } from 'vitest';

import {
  createFakeNbaClient,
  leagueFixture,
  spot,
  statRow,
  type FakeNbaData,
} from './__fixtures__/fakeNbaClient';
import { loadPlayerPool } from './playerPool';

const teams = [
  { id: 't-bos', code: 'BOS' },
  { id: 't-nyk', code: 'NYK' },
];

function data(): FakeNbaData {
  return {
    teams,
    players: [
      { id: 'scorer', fullName: 'Sam Scorer', positions: ['G'], teamId: 't-bos' },
      { id: 'boards', fullName: 'Ben Boards', positions: ['C'], teamId: 't-nyk' },
      { id: 'vet', fullName: 'Vic Veteran', positions: ['F'], teamId: 't-bos' },
      { id: 'retired', fullName: 'Rex Retired', positions: ['F'], teamId: null, active: false },
      {
        id: 'hurt',
        fullName: 'Hal Hurt',
        positions: ['F'],
        teamId: 't-nyk',
        injury: { status: 'OUT', detail: 'Knee', expectedReturnOn: '2026-11-20' },
      },
    ],
    games: [
      {
        id: 'g27a',
        season: 2027,
        gameDate: '2026-10-21',
        status: 'FINAL',
        homeTeamId: 't-bos',
        awayTeamId: 't-nyk',
      },
      {
        id: 'g27b',
        season: 2027,
        gameDate: '2026-10-23',
        status: 'FINAL',
        homeTeamId: 't-nyk',
        awayTeamId: 't-bos',
      },
      {
        id: 'g27c',
        season: 2027,
        gameDate: '2026-11-09',
        status: 'SCHEDULED',
        homeTeamId: 't-bos',
        awayTeamId: 't-nyk',
      },
      {
        id: 'g26',
        season: 2026,
        gameDate: '2026-03-01',
        status: 'FINAL',
        homeTeamId: 't-bos',
        awayTeamId: 't-nyk',
      },
      {
        id: 'g25',
        season: 2025,
        gameDate: '2025-03-01',
        status: 'FINAL',
        homeTeamId: 't-bos',
        awayTeamId: 't-nyk',
      },
    ],
    stats: [
      statRow('g27a', 'scorer', 't-bos', { points: 30, secondsPlayed: 2100 }),
      statRow('g27b', 'scorer', 't-bos', { points: 20, secondsPlayed: 2100 }),
      // A scheduled game's row and a did-not-play row never count.
      statRow('g27c', 'scorer', 't-bos', { points: 99 }),
      statRow('g27a', 'boards', 't-nyk', { rebounds: 14, played: true }),
      statRow('g27b', 'boards', 't-nyk', { played: false, secondsPlayed: 0 }),
      statRow('g26', 'boards', 't-nyk', { rebounds: 10 }),
      statRow('g26', 'vet', 't-bos', { assists: 6 }),
      // Two seasons ago is ignored.
      statRow('g25', 'vet', 't-bos', { assists: 50 }),
      statRow('g26', 'retired', 't-bos', { points: 25 }),
      statRow('g26', 'hurt', 't-nyk', { steals: 2 }),
    ],
    runs: [
      { job: 'BOX_SCORES', outcome: 'SUCCEEDED', finishedAt: new Date('2026-11-08T10:00:00Z') },
      { job: 'BOX_SCORES', outcome: 'REJECTED', finishedAt: new Date('2026-11-08T12:00:00Z') },
    ],
  };
}

const today = '2026-11-08';

describe('loadPlayerPool', () => {
  it('counts only played FINAL games of this season and last season', async () => {
    const pool = await loadPlayerPool(leagueFixture(), {
      client: createFakeNbaClient(data()),
      today,
    });
    const byId = new Map(pool.players.map((player) => [player.playerId, player]));

    expect(pool.season).toBe(2027);
    expect(pool.lastSeason).toBe(2026);
    expect(byId.get('scorer')).toMatchObject({
      gamesThisSeason: 2,
      gamesLastSeason: 0,
      minutesPerGame: 35,
    });
    expect(byId.get('scorer')?.perGame.points).toBeCloseTo(25 * (2 / 15) + 8 * (13 / 15));
    expect(byId.get('boards')).toMatchObject({ gamesThisSeason: 1, gamesLastSeason: 1 });
    expect(byId.get('vet')).toMatchObject({ gamesThisSeason: 0, gamesLastSeason: 1 });
    expect(byId.get('vet')?.perGame.assists).toBe(6);
  });

  it('lists active players with identity and injury, leaving out inactive free agents', async () => {
    const pool = await loadPlayerPool(leagueFixture(), {
      client: createFakeNbaClient(data()),
      today,
    });

    expect(pool.players.map((player) => player.playerId).sort()).toEqual([
      'boards',
      'hurt',
      'scorer',
      'vet',
    ]);
    expect(pool.players.find((player) => player.playerId === 'hurt')).toMatchObject({
      fullName: 'Hal Hurt',
      teamCode: 'NYK',
      positions: ['F'],
      injury: { status: 'OUT', detail: 'Knee', expectedReturnOn: '2026-11-20' },
    });
    expect(pool.statsUpdatedAt).toBe('2026-11-08T10:00:00.000Z');
  });

  it('keeps an inactive player who is rostered in this league', async () => {
    const pool = await loadPlayerPool(
      leagueFixture({ rosterSpots: [spot('retired', 'team-me')] }),
      { client: createFakeNbaClient(data()), today }
    );

    expect(pool.players.find((player) => player.playerId === 'retired')?.owner).toEqual({
      kind: 'MINE',
      teamName: 'My Team',
    });
  });

  it('labels owners: mine, this week’s opponent, another team, elsewhere and free agent', async () => {
    const league = leagueFixture({
      rosterSpots: [
        spot('scorer', 'team-me'),
        spot('boards', 'team-opp'),
        spot('vet', 'team-other'),
        spot('hurt', null),
      ],
      // Week 3 is 2–8 Nov; week 2's opponent must not leak into week 3.
      matchups: [
        { week: 2, teamId: 'team-me', opponentTeamId: 'team-other' },
        { week: 3, teamId: 'team-me', opponentTeamId: 'team-opp' },
      ],
    });
    const extra = data();
    extra.players.push({ id: 'free', fullName: 'Fay Free', positions: ['G'], teamId: 't-bos' });
    extra.stats.push(statRow('g27a', 'free', 't-bos', { points: 4 }));

    const pool = await loadPlayerPool(league, { client: createFakeNbaClient(extra), today });
    const owner = (id: string) => pool.players.find((player) => player.playerId === id)?.owner;

    expect(owner('scorer')).toEqual({ kind: 'MINE', teamName: 'My Team' });
    expect(owner('boards')).toEqual({ kind: 'OPPONENT', teamName: 'Rivals' });
    expect(owner('vet')).toEqual({ kind: 'TEAM', teamName: 'Others' });
    expect(owner('hurt')).toEqual({ kind: 'ELSEWHERE', teamName: null });
    expect(owner('free')).toEqual({ kind: 'FREE_AGENT', teamName: null });
  });

  it('values with the league punts unless a what-if override is given', async () => {
    const league = leagueFixture({ categories: ['PTS', 'REB'], puntCategories: [] });
    const client = createFakeNbaClient(data());
    const rank = (pool: Awaited<ReturnType<typeof loadPlayerPool>>, id: string) =>
      pool.players.find((player) => player.playerId === id)?.rank;

    const plain = await loadPlayerPool(league, { client, today });
    const puntPoints = await loadPlayerPool(league, { client, today, punts: ['PTS'] });
    const leaguePuntsRebounds = await loadPlayerPool(
      { ...league, puntCategories: ['REB'] },
      { client, today }
    );

    expect(puntPoints.punts).toEqual(['PTS']);
    expect(puntPoints.leaguePunts).toEqual([]);
    expect(rank(puntPoints, 'boards')).toBe(1);
    expect(rank(leaguePuntsRebounds, 'scorer')).toBe(1);
    expect(leaguePuntsRebounds.punts).toEqual(['REB']);
    expect(plain.punts).toEqual([]);
  });

  it('prices players only when the league has an auction budget', async () => {
    const client = createFakeNbaClient(data());
    const noBudget = await loadPlayerPool(leagueFixture(), { client, today });
    const budget = await loadPlayerPool(
      leagueFixture({
        auctionBudget: 200,
        teamCount: 2,
        rosterSlots: {
          ...leagueFixture().rosterSlots,
          BN: 0,
          UTIL: 0,
          C: 0,
          F: 0,
          G: 0,
          SF: 0,
          PF: 0,
          SG: 0,
          PG: 1,
        },
      }),
      { client, today }
    );

    expect(noBudget.players.every((player) => player.auctionDollars === null)).toBe(true);
    // Two teams × one spot: the top two split 2 × 200 − 2 dollars above $1; the rest are $1.
    const dollars = budget.players.map((player) => player.auctionDollars);
    expect(dollars.slice(2)).toEqual([1, 1]);
    expect((dollars[0] ?? 0) + (dollars[1] ?? 0)).toBeGreaterThanOrEqual(399);
  });

  it('returns no players when no NBA stats are loaded', async () => {
    const pool = await loadPlayerPool(leagueFixture(), {
      client: createFakeNbaClient({ teams, players: [], games: [], stats: [] }),
      today,
    });
    expect(pool.players).toEqual([]);
    expect(pool.statsUpdatedAt).toBeNull();
  });
});
