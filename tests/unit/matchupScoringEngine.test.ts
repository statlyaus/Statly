import { describe, expect, it } from 'vitest';

import {
  aggregateLineupCategoryTotals,
  scoreHeadToHeadCategories,
} from '@/server/leagues/matchupScoringEngine';
import { categoryStatInputs, REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

describe('matchup scoring engine', () => {
  it('aggregates active lineup totals for the AFL 9-category preset and excludes bench', () => {
    const totals = aggregateLineupCategoryTotals({
      categories: REAL_DATA_NINE_CATEGORY_PRESET,
      players: [
        {
          playerId: 'p1',
          slot: 'FWD',
          totals: { goals: 2, tackles: 6, inside50s: 3 },
        },
        {
          playerId: 'p2',
          slot: 'UTIL',
          totals: { goals: 1, tackles: 4, rebound50s: 2, scoreInvolvements: 5 },
        },
        {
          playerId: 'p3',
          slot: 'BENCH',
          totals: { goals: 99, tackles: 99, inside50s: 99 },
        },
      ],
    });

    expect(totals).toMatchObject({
      goals: 3,
      tackles: 10,
      inside50s: 3,
      rebound50s: 2,
      scoreInvolvements: 5,
    });
  });

  it('scores each category and supports lower-is-better categories', () => {
    const result = scoreHeadToHeadCategories({
      categories: ['goals', 'tackles', 'clangers'],
      categoryDirections: { goals: 'HIGH_WINS', tackles: 'HIGH_WINS', clangers: 'LOW_WINS' },
      homeTotals: { goals: 12, tackles: 50, clangers: 20 },
      awayTotals: { goals: 10, tackles: 55, clangers: 25 },
      scoringMode: 'H2H_EACH_CATEGORY',
    });

    expect(result.homeCategoryWins).toBe(2);
    expect(result.awayCategoryWins).toBe(1);
    expect(result.drawnCategories).toBe(0);
    expect(result.homeMatchupWin).toBe(true);
    expect(result.awayMatchupWin).toBe(false);
  });

  it('returns matchup draw when category wins are tied in most-categories mode', () => {
    const result = scoreHeadToHeadCategories({
      categories: ['goals', 'tackles'],
      categoryDirections: { goals: 'HIGH_WINS', tackles: 'HIGH_WINS' },
      homeTotals: { goals: 12, tackles: 50 },
      awayTotals: { goals: 10, tackles: 55 },
      scoringMode: 'H2H_MOST_CATEGORIES',
    });

    expect(result.homeCategoryWins).toBe(1);
    expect(result.awayCategoryWins).toBe(1);
    expect(result.matchupDraw).toBe(true);
  });

  // Owner decision 2026-11-11: team DE% is total effective disposals / total disposals x 100 across
  // the counted players, never a sum or a plain average of the players' percentages.
  describe('team disposal efficiency', () => {
    const categories = ['goals', 'disposalEffPct'] as const;

    it('is effective disposals over disposals, not the sum of player percentages', () => {
      const totals = aggregateLineupCategoryTotals({
        categories,
        players: [
          {
            playerId: 'p1',
            slot: 'MID',
            totals: { goals: 1, disposalEffPct: 75, effectiveDisposals: 15, disposals: 20 },
          },
          {
            playerId: 'p2',
            slot: 'DEF',
            totals: { goals: 2, disposalEffPct: 50, effectiveDisposals: 5, disposals: 10 },
          },
          {
            playerId: 'p3',
            slot: 'BENCH',
            totals: { goals: 9, disposalEffPct: 100, effectiveDisposals: 30, disposals: 30 },
          },
        ],
      });

      expect(totals.goals).toBe(3);
      // 20 / 30, not 125 (sum) or 62.5 (average of percentages).
      expect(totals.disposalEffPct).toBeCloseTo(66.667, 3);
    });

    it('counts a player with no disposals as 0 of 0, so he does not move the ratio', () => {
      const totals = aggregateLineupCategoryTotals({
        categories,
        players: [
          { playerId: 'p1', slot: 'MID', totals: { effectiveDisposals: 15, disposals: 20 } },
          { playerId: 'p2', slot: 'FWD', totals: { goals: 1, disposals: 0 } },
        ],
      });

      expect(totals.disposalEffPct).toBe(75);
    });

    it('is unavailable for a team with no disposals, and that category is drawn', () => {
      const homeTotals = aggregateLineupCategoryTotals({
        categories,
        players: [{ playerId: 'p1', slot: 'MID', totals: { goals: 1, disposals: 0 } }],
      });
      const awayTotals = aggregateLineupCategoryTotals({
        categories,
        players: [
          { playerId: 'p2', slot: 'MID', totals: { effectiveDisposals: 8, disposals: 10 } },
        ],
      });

      expect(homeTotals.disposalEffPct).toBeUndefined();
      expect(awayTotals.disposalEffPct).toBe(80);

      const result = scoreHeadToHeadCategories({
        categories,
        categoryDirections: {},
        homeTotals,
        awayTotals,
        scoringMode: 'H2H_EACH_CATEGORY',
      });

      expect(result.categories.find((row) => row.category === 'disposalEffPct')).toEqual({
        category: 'disposalEffPct',
        homeValue: null,
        awayValue: 80,
        direction: 'HIGH_WINS',
        winner: 'draw',
      });
      expect(result).toMatchObject({
        homeCategoryWins: 1,
        awayCategoryWins: 0,
        drawnCategories: 1,
      });
    });
  });

  it('names the per-player stats each category is computed from', () => {
    expect(categoryStatInputs('goals')).toEqual(['goals']);
    expect(categoryStatInputs('disposalEffPct')).toEqual(['effectiveDisposals', 'disposals']);
  });
});
