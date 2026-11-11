import { describe, expect, it } from 'vitest';

import { aggregateLineupCategoryTotals } from '@/server/leagues/matchupScoringEngine';
import {
  applyNoLosersResultRule,
  countedLineupPlayers,
  NO_LOSERS_RESULT_RULE_VERSION,
  type NoLosersLineupPlayer,
  type NoLosersMatchResult,
} from '@/server/leagues/noLosersResultRule';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

function game(homePoints: number, awayPoints: number, status: 'FINAL' | 'ABANDONED' = 'FINAL') {
  return new Map<string, NoLosersMatchResult>([
    ['m1', { homeClub: 'Carlton', awayClub: 'Richmond', homePoints, awayPoints, status }],
  ]);
}

function player(overrides: Partial<NoLosersLineupPlayer> = {}): NoLosersLineupPlayer {
  return {
    playerId: 'p1',
    slot: 'MID',
    club: 'Carlton',
    matchId: 'm1',
    totals: { goals: 3, tackles: 8, clangers: 5 },
    ...overrides,
  };
}

function only(results: Map<string, NoLosersMatchResult>, p = player()) {
  return applyNoLosersResultRule({ players: [p], results }).players[0];
}

describe('No Losers result rule', () => {
  it('stamps the rule version', () => {
    expect(applyNoLosersResultRule({ players: [], results: new Map() }).ruleVersion).toBe(
      NO_LOSERS_RESULT_RULE_VERSION
    );
  });

  it('counts a winner in full', () => {
    const scored = only(game(90, 60));
    expect(scored.outcome).toEqual({
      kind: 'RESULT',
      clubResult: 'WIN',
      margin: 30,
      multiplier: 1,
    });
    expect(scored.countedTotals).toEqual({ goals: 3, tackles: 8, clangers: 5 });
  });

  it('counts a draw at half (BR-13)', () => {
    const scored = only(game(70, 70));
    expect(scored.outcome).toMatchObject({ clubResult: 'DRAW', margin: 0, multiplier: 0.5 });
    expect(scored.countedTotals).toEqual({ goals: 1.5, tackles: 4, clangers: 2.5 });
  });

  it('counts a 5-point loss at half and a 6-point loss at nothing (BR-14)', () => {
    expect(only(game(70, 75)).outcome).toMatchObject({
      clubResult: 'LOSS',
      margin: -5,
      multiplier: 0.5,
    });
    expect(only(game(70, 75)).countedTotals).toMatchObject({ goals: 1.5 });
    expect(only(game(70, 76)).outcome).toMatchObject({
      clubResult: 'LOSS',
      margin: -6,
      multiplier: 0,
    });
    expect(only(game(70, 76)).countedTotals).toEqual({ goals: 0, tackles: 0, clangers: 0 });
  });

  it('reads the away side of the match', () => {
    const scored = only(game(90, 60), player({ club: 'Richmond' }));
    expect(scored.outcome).toMatchObject({ clubResult: 'LOSS', margin: -30, multiplier: 0 });
  });

  it('counts an abandoned game in full (BR-15)', () => {
    const scored = only(game(0, 0, 'ABANDONED'));
    expect(scored.outcome).toEqual({
      kind: 'RESULT',
      clubResult: 'ABANDONED',
      margin: null,
      multiplier: 1,
    });
    expect(scored.countedTotals).toEqual({ goals: 3, tackles: 8, clangers: 5 });
  });

  it('zeroes a low-wins category for a loser too (BR-11)', () => {
    const totals = aggregateLineupCategoryTotals({
      categories: ['clangers'],
      players: countedLineupPlayers(
        applyNoLosersResultRule({ players: [player()], results: game(40, 100) })
      )!,
    });
    expect(totals.clangers).toBe(0);
  });

  it('makes DE% unavailable when every counted player is zeroed (BR-12)', () => {
    const output = applyNoLosersResultRule({
      players: [
        player({ totals: { effectiveDisposals: 20, disposals: 25, disposalEffPct: 80 } }),
        player({
          playerId: 'p2',
          totals: { effectiveDisposals: 10, disposals: 20, disposalEffPct: 50 },
        }),
      ],
      results: game(40, 100),
    });
    const totals = aggregateLineupCategoryTotals({
      categories: ['disposalEffPct'],
      players: countedLineupPlayers(output)!,
    });
    expect(totals).toEqual({ effectiveDisposals: 0, disposals: 0 });
    expect(totals.disposalEffPct).toBeUndefined();
  });

  it('weighs a halved player at half in DE% (BR-12)', () => {
    const results = new Map<string, NoLosersMatchResult>([
      [
        'm1',
        {
          homeClub: 'Carlton',
          awayClub: 'Richmond',
          homePoints: 70,
          awayPoints: 70,
          status: 'FINAL',
        },
      ],
      [
        'm2',
        {
          homeClub: 'Geelong',
          awayClub: 'Sydney',
          homePoints: 90,
          awayPoints: 50,
          status: 'FINAL',
        },
      ],
    ]);
    const output = applyNoLosersResultRule({
      players: [
        // Drew: 20/20 counts as 10/10.
        player({ totals: { effectiveDisposals: 20, disposals: 20, disposalEffPct: 100 } }),
        // Won: 10/20 counts in full.
        player({
          playerId: 'p2',
          club: 'Geelong',
          matchId: 'm2',
          totals: { effectiveDisposals: 10, disposals: 20, disposalEffPct: 50 },
        }),
      ],
      results,
    });
    expect(output.players[0].countedTotals).toEqual({
      effectiveDisposals: 10,
      disposals: 10,
      disposalEffPct: 100,
    });
    const totals = aggregateLineupCategoryTotals({
      categories: ['disposalEffPct'],
      players: countedLineupPlayers(output)!,
    });
    expect(totals.disposalEffPct).toBeCloseTo((20 / 30) * 100);
  });

  it('passes bench and interchange through untouched (BR-17)', () => {
    const output = applyNoLosersResultRule({
      players: [
        player({ playerId: 'bench', slot: 'BENCH' }),
        player({ playerId: 'ic', slot: 'INTERCHANGE', matchId: 'missing' }),
      ],
      results: game(40, 100),
    });
    for (const scored of output.players) {
      expect(scored.outcome).toEqual({ kind: 'NOT_COUNTED_SLOT' });
      expect(scored.countedTotals).toEqual({ goals: 3, tackles: 8, clangers: 5 });
    }
    expect(output.unavailablePlayerIds).toEqual([]);
  });

  it('keeps a missing stat value missing (#1270)', () => {
    const scored = only(game(70, 70), player({ totals: { goals: 2 } }));
    expect(scored.countedTotals).toEqual({ goals: 1 });
    expect('tackles' in scored.countedTotals!).toBe(false);
  });

  it('leaves a player with no stat row unavailable exactly as today', () => {
    const output = applyNoLosersResultRule({
      players: [player({ matchId: null, totals: {} })],
      results: game(70, 70),
    });
    expect(output.players[0].outcome).toEqual({ kind: 'NO_STAT_ROW' });
    expect(output.unavailablePlayerIds).toEqual([]);
  });

  it.each([
    ['RESULT_MISSING', player({ matchId: 'm9' })],
    ['CLUB_NOT_IN_MATCH', player({ club: 'Geelong' })],
    ['STATS_WITHOUT_MATCH', player({ matchId: null })],
  ])('never guesses a result: %s is unavailable (BR-08)', (reason, p) => {
    const output = applyNoLosersResultRule({ players: [p], results: game(90, 60) });
    expect(output.players[0].outcome).toEqual({ kind: 'UNAVAILABLE', reason });
    expect(output.players[0].countedTotals).toBeNull();
    expect(output.unavailablePlayerIds).toEqual(['p1']);
    expect(countedLineupPlayers(output)).toBeNull();
  });

  it('golden: an all-winners lineup aggregates byte-identical to the standard engine', () => {
    const players: NoLosersLineupPlayer[] = [
      player({
        totals: {
          goals: 2,
          tackles: 6,
          inside50s: 3,
          effectiveDisposals: 17,
          disposals: 23,
          disposalEffPct: 73.9,
        },
      }),
      player({
        playerId: 'p2',
        slot: 'UTIL',
        totals: { goals: 1, rebound50s: 2, scoreInvolvements: 5, disposals: 12 },
      }),
      player({ playerId: 'p3', slot: 'BENCH', totals: { goals: 99 } }),
    ];
    const standard = aggregateLineupCategoryTotals({
      categories: REAL_DATA_NINE_CATEGORY_PRESET,
      players,
    });
    const noLosers = aggregateLineupCategoryTotals({
      categories: REAL_DATA_NINE_CATEGORY_PRESET,
      players: countedLineupPlayers(applyNoLosersResultRule({ players, results: game(100, 50) }))!,
    });
    expect(JSON.stringify(noLosers)).toBe(JSON.stringify(standard));
  });
});
