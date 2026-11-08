import { describe, expect, it } from 'vitest';
import type { NbaStatLine } from '@/types/basketball';
import type { PlayerProjection } from './projection';
import { emptyStatLine } from './statLine';
import { auctionValues, valuePlayers, type PlayerValue } from './valuation';

function projection(
  playerId: string,
  minutesPerGame: number,
  perGame: Partial<NbaStatLine>,
  games = { thisSeason: 10, lastSeason: 60 }
): PlayerProjection {
  return {
    playerId,
    gamesThisSeason: games.thisSeason,
    gamesLastSeason: games.lastSeason,
    weightThisSeason: Math.min(1, games.thisSeason / 15),
    minutesPerGame,
    perGame: { ...emptyStatLine(), ...perGame },
  };
}

// Pool (MPG >= 20): A, B, C, D. E plays 12 minutes: valued, but not in the pool.
// PTS pool 30, 20, 10, 20: mean 20, population SD sqrt(50).
// TO pool 4, 2, 1, 1: mean 2, SD sqrt(1.5); negated because low wins.
// FG pool 25/50 = 50 %; impact = makes - 0.5 * attempts = 0, 3, -2, -1: mean 0, SD sqrt(3.5).
const POOL = [
  projection('A', 35, { points: 30, fieldGoalsMade: 10, fieldGoalsAttempted: 20, turnovers: 4 }),
  projection('B', 30, { points: 20, fieldGoalsMade: 8, fieldGoalsAttempted: 10, turnovers: 2 }),
  projection('C', 25, { points: 10, fieldGoalsMade: 3, fieldGoalsAttempted: 10, turnovers: 1 }),
  projection('D', 20, { points: 20, fieldGoalsMade: 4, fieldGoalsAttempted: 10, turnovers: 1 }),
  projection('E', 12, { points: 5, fieldGoalsMade: 2, fieldGoalsAttempted: 2, turnovers: 0 }),
];

function byId(values: PlayerValue[]): Record<string, PlayerValue> {
  return Object.fromEntries(values.map((value) => [value.playerId, value]));
}

describe('valuePlayers', () => {
  it('scores counting categories as z over the pool, with turnovers negated', () => {
    const values = byId(valuePlayers(POOL, { categories: ['FG_PCT', 'PTS', 'TO'] }));

    expect(values.A.categoryZ.PTS).toBeCloseTo(1.4142136, 6);
    expect(values.C.categoryZ.PTS).toBeCloseTo(-1.4142136, 6);
    expect(values.E.categoryZ.PTS).toBeCloseTo(-2.1213203, 6);
    expect(values.A.categoryZ.TO).toBeCloseTo(-1.6329932, 6);
    expect(values.C.categoryZ.TO).toBeCloseTo(0.8164966, 6);
    expect(values.E.categoryZ.TO).toBeCloseTo(1.6329932, 6);
  });

  it('weights percentages by attempts against the pool percentage', () => {
    const values = byId(valuePlayers(POOL, { categories: ['FG_PCT', 'PTS', 'TO'] }));

    expect(values.A.categoryZ.FG_PCT).toBeCloseTo(0, 6);
    expect(Object.is(values.B.categoryZ.TO, 0)).toBe(true);
    expect(values.B.categoryZ.FG_PCT).toBeCloseTo(1.6035675, 6);
    expect(values.C.categoryZ.FG_PCT).toBeCloseTo(-1.069045, 6);
    expect(values.D.categoryZ.FG_PCT).toBeCloseTo(-0.5345225, 6);
    // 100 % on two attempts is worth less than B's 80 % on ten.
    expect(values.E.categoryZ.FG_PCT).toBeCloseTo(0.5345225, 6);
  });

  it('totals the league categories, ranks every player and marks the pool', () => {
    const values = valuePlayers(POOL, { categories: ['FG_PCT', 'PTS', 'TO'] });

    expect(values.map((value) => [value.playerId, value.rank])).toEqual([
      ['B', 1],
      ['D', 2],
      ['E', 3],
      ['A', 4],
      ['C', 5],
    ]);
    const byPlayer = byId(values);
    expect(byPlayer.B.total).toBeCloseTo(1.6035675, 6);
    expect(byPlayer.C.total).toBeCloseTo(-1.6667619, 6);
    expect(byPlayer.E.total).toBeCloseTo(0.0461953, 6);
    expect(byPlayer.A.inPool).toBe(true);
    expect(byPlayer.D.inPool).toBe(true);
    expect(byPlayer.E.inPool).toBe(false);
  });

  it('leaves punted categories out of the total but still reports their z', () => {
    const values = byId(
      valuePlayers(POOL, { categories: ['FG_PCT', 'PTS', 'TO'], punts: ['PTS'] })
    );

    expect(values.E.total).toBeCloseTo(2.1675156, 6);
    expect(values.A.total).toBeCloseTo(-1.6329932, 6);
    expect(values.A.categoryZ.PTS).toBeCloseTo(1.4142136, 6);
    expect(values.E.rank).toBe(1);
  });

  it('gives z of 0 where the pool has no spread or no attempts', () => {
    const values = byId(valuePlayers(POOL, { categories: ['FT_PCT', 'REB', 'PTS'] }));

    expect(values.A.categoryZ.REB).toBe(0);
    expect(values.A.categoryZ.FT_PCT).toBe(0);
    expect(values.A.total).toBeCloseTo(1.4142136, 6);
  });

  it('values nobody above anybody when every category is punted', () => {
    const values = valuePlayers(POOL, {
      categories: ['FG_PCT', 'PTS', 'TO'],
      punts: ['FG_PCT', 'PTS', 'TO'],
    });

    expect(values.every((value) => value.total === 0)).toBe(true);
    expect(values.map((value) => value.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it('skips players with no games and handles an empty pool', () => {
    const noGames = projection('Z', 30, { points: 40 }, { thisSeason: 0, lastSeason: 0 });
    expect(valuePlayers([...POOL, noGames], { categories: ['PTS'] })).toHaveLength(5);

    const values = valuePlayers(POOL, { categories: ['PTS'], minPoolMinutes: 40 });
    expect(values.every((value) => value.total === 0 && !value.inPool)).toBe(true);
  });
});

function value(playerId: string, total: number): PlayerValue {
  return {
    playerId,
    total,
    rank: 0,
    inPool: true,
    categoryZ: {} as PlayerValue['categoryZ'],
  };
}

describe('auctionValues', () => {
  // The sheet's league: 12 teams × 14 spots, $200 each. Replacement is the 169th best value
  // (-2.63), value above replacement sums to 414.63, and 12 × 200 − 168 = $2232 is bid above $1.
  const LEAGUE = { teamCount: 12, rosterSpots: 14, budget: 200 };
  const values = [
    value('star', 72.37), // 75 above replacement
    value('sheet-example', 5), // 7.63 above
    ...Array.from({ length: 166 }, (_, index) => value(`depth-${index}`, -0.63)), // 2 above each
    value('replacement', -2.63),
    value('waiver', -4),
  ];

  it('reproduces the sheet: a player valued 5.00 is worth $42', () => {
    const dollars = auctionValues(values, LEAGUE);

    expect(dollars['sheet-example']).toBe(42); // ROUND(1 + 7.63 / 414.63 × 2232)
    expect(dollars.star).toBe(405); // ROUND(404.73)
    expect(dollars['depth-0']).toBe(12); // ROUND(11.77)
    expect(dollars.replacement).toBe(1);
    expect(dollars.waiver).toBe(1);
  });

  it('uses the worst player as replacement when fewer players than roster spots exist', () => {
    const dollars = auctionValues([value('a', 3), value('b', 1), value('c', -1)], {
      teamCount: 2,
      rosterSpots: 2,
      budget: 10,
    });
    // repl = -1; above = 4 + 2 = 6; pool $ = 20 - 4 = 16.
    expect(dollars).toEqual({ a: 12, b: 6, c: 1 }); // 1 + 4/6×16 = 11.67; 1 + 2/6×16 = 6.33
  });

  it('gives everyone $1 when nobody is above replacement', () => {
    expect(auctionValues([value('a', 0), value('b', 0)], LEAGUE)).toEqual({ a: 1, b: 1 });
    expect(auctionValues([], LEAGUE)).toEqual({});
  });
});
