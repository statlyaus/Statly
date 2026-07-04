import { describe, expect, it } from 'vitest';

import {
  aggregateLineupCategoryTotals,
  scoreHeadToHeadCategories,
} from '@/server/leagues/matchupScoringEngine';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

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
});
