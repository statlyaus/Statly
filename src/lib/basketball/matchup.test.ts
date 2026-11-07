import { describe, expect, it } from 'vitest';
import type { BasketballRosterSlotCounts, NbaStatLine } from '@/types/basketball';
import type { LineupRosterEntry } from './lineupSimulator';
import {
  matchupOutcome,
  normalCdf,
  projectMatchup,
  projectRestOfWeek,
  type MatchupSide,
} from './matchup';
import { emptyStatLine } from './statLine';

function statLine(values: Partial<NbaStatLine>): NbaStatLine {
  return { ...emptyStatLine(), ...values };
}

const UTIL_ONLY: BasketballRosterSlotCounts = {
  PG: 0,
  SG: 0,
  G: 0,
  SF: 0,
  PF: 0,
  F: 0,
  C: 0,
  UTIL: 1,
  BN: 0,
  IL: 0,
};

function rosterOf(playerId: string): LineupRosterEntry[] {
  return [
    {
      playerId,
      positions: ['C'],
      value: 1,
      onInjuredList: false,
      out: false,
      acquiredOn: '2026-10-19',
    },
  ];
}

describe('normalCdf', () => {
  it('matches standard normal table values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1)).toBeCloseTo(0.8413447, 6);
    expect(normalCdf(-1.96)).toBeCloseTo(0.0249979, 6);
    expect(normalCdf(3)).toBeCloseTo(0.9986501, 6);
  });
});

describe('matchupOutcome', () => {
  it('reports a 4-4 tie separately in an 8-category league', () => {
    const outcome = matchupOutcome(Array.from({ length: 8 }, () => 0.5));
    expect(outcome.tie).toBeCloseTo(70 / 256, 12);
    expect(outcome.win).toBeCloseTo(93 / 256, 12);
    expect(outcome.loss).toBeCloseTo(93 / 256, 12);
  });

  it('needs five of nine categories, with no tie possible', () => {
    const outcome = matchupOutcome(Array.from({ length: 9 }, () => 0.9));
    expect(outcome.win).toBeCloseTo(0.99910908, 8);
    expect(outcome.tie).toBe(0);
  });

  it('handles certain categories', () => {
    expect(matchupOutcome([1, 0, 0.5])).toEqual({ win: 0.5, tie: 0, loss: 0.5 });
  });
});

describe('projectMatchup', () => {
  // One UTIL slot and two days left, both players playing both days: rest of week = 2 × per game.
  const remainingDays = [
    { date: '2026-11-07', playing: ['m', 'o'] },
    { date: '2026-11-08', playing: ['m', 'o'] },
  ];
  const me: MatchupSide = {
    roster: rosterOf('m'),
    perGame: {
      m: statLine({
        points: 100,
        turnovers: 5,
        fieldGoalsMade: 25,
        fieldGoalsAttempted: 50,
        rebounds: 10,
      }),
    },
    actual: statLine({
      points: 300,
      turnovers: 10,
      fieldGoalsMade: 40,
      fieldGoalsAttempted: 100,
      rebounds: 80,
      steals: 10,
    }),
  };
  const opponent: MatchupSide = {
    roster: rosterOf('o'),
    perGame: {
      o: statLine({
        points: 75,
        turnovers: 4,
        fieldGoalsMade: 20,
        fieldGoalsAttempted: 40,
        rebounds: 9,
      }),
    },
    actual: statLine({
      points: 330,
      turnovers: 14,
      fieldGoalsMade: 45,
      fieldGoalsAttempted: 100,
      rebounds: 80,
      steals: 5,
    }),
  };
  const input = {
    categories: ['FG_PCT', 'PTS', 'REB', 'AST', 'STL', 'TO'] as const,
    format: 'H2H_MOST_CATEGORIES' as const,
    slots: UTIL_ONLY,
    remainingDays,
    me,
    opponent,
  };

  it('adds the simulated rest of the week to the actuals', () => {
    const result = projectMatchup(input);

    expect(result.me.gamesLeft).toEqual({ m: 2 });
    expect(result.me.restOfWeek.points).toBe(200);
    expect(result.me.total.points).toBe(500);
    expect(result.opponent.total.fieldGoalsAttempted).toBe(180);
  });

  it('puts uncertainty on the remaining volume only (sheet Weekly Projections)', () => {
    const byCategory = Object.fromEntries(
      projectMatchup(input).categories.map((category) => [category.category, category])
    );

    // PTS: σ² = 2.5·200 + 12² + 2.5·150 + 9² = 1100.
    expect(byCategory.PTS).toMatchObject({ me: 500, opponent: 480, margin: 20, call: 'WIN' });
    expect(byCategory.PTS.sigma).toBeCloseTo(33.1662479, 6);
    expect(byCategory.PTS.winChance).toBeCloseTo(0.7267532, 6);

    // TO: fewer wins, so the margin is opponent − me.
    expect(byCategory.TO).toMatchObject({ me: 20, opponent: 22, margin: 2, call: 'WIN' });
    expect(byCategory.TO.sigma).toBeCloseTo(4.3116586, 6);
    expect(byCategory.TO.winChance).toBeCloseTo(0.6786255, 6);

    // FG%: per side sqrt(A·p(1−p)·1.2 + (0.02A)²) / Atot, combined in quadrature.
    expect(byCategory.FG_PCT.me).toBeCloseTo(0.45, 12);
    expect(byCategory.FG_PCT.margin).toBeCloseTo(-0.0222222, 6);
    expect(byCategory.FG_PCT.call).toBe('LOSS');
    expect(byCategory.FG_PCT.sigma).toBeCloseTo(0.0407427, 6);
    expect(byCategory.FG_PCT.winChance).toBeCloseTo(0.2927294, 6);

    // REB: 100 v 98 is inside the 3 % band.
    expect(byCategory.REB.call).toBe('TOSS_UP');
    expect(byCategory.REB.sigma).toBeCloseTo(6.9430829, 6);

    // Nothing left to play: σ = 0, so the chance follows the sign.
    expect(byCategory.STL).toMatchObject({ sigma: 0, winChance: 1, call: 'WIN' });
    expect(byCategory.AST).toMatchObject({ sigma: 0, winChance: 0.5, call: 'TOSS_UP' });
  });

  it('sums calls, expected categories and the matchup chance', () => {
    const result = projectMatchup(input);

    expect(result.calls).toEqual({ wins: 3, losses: 1, tossUps: 2 });
    expect(result.expectedCategoriesWon).toBeCloseTo(3.8114564, 6);
    expect(result.expectedCategoriesLost).toBeCloseTo(2.1885436, 6);
    expect(result.outcome?.win).toBeCloseTo(0.6234602, 6);
    expect(result.outcome?.tie).toBeCloseTo(0.2712183, 6);
    expect(result.outcome?.loss).toBeCloseTo(0.1053215, 6);
  });

  it('gives an each-category league an expected record and no matchup win', () => {
    const result = projectMatchup({ ...input, format: 'H2H_EACH_CATEGORY' });

    expect(result.outcome).toBeNull();
    expect(result.expectedCategoriesWon).toBeCloseTo(3.8114564, 6);
  });

  it('settles every category once the week is over', () => {
    const result = projectMatchup({ ...input, remainingDays: [] });

    expect(result.me.total).toEqual(me.actual);
    expect(result.categories.map((category) => category.winChance)).toEqual([
      0, // FG% 40 % v 45 %
      0, // PTS 300 v 330
      0.5, // REB 80 v 80
      0.5, // AST 0 v 0
      1, // STL 10 v 5
      1, // TO 10 v 14
    ]);
  });
});

describe('projectRestOfWeek', () => {
  it('leaves players with no projection out of the lineup, so they never block a bench player', () => {
    const roster = [{ ...rosterOf('unprojected')[0], value: 10 }, ...rosterOf('bench')];
    const result = projectRestOfWeek({
      roster,
      perGame: { bench: statLine({ points: 10 }) },
      slots: UTIL_ONLY,
      days: [{ date: '2026-11-07', playing: ['unprojected', 'bench'] }],
    });

    expect(result.lineups).toEqual([{ date: '2026-11-07', starters: ['bench'] }]);
    expect(result.gamesLeft).toEqual({ bench: 1 });
    expect(result.restOfWeek.points).toBe(10);
  });
});
