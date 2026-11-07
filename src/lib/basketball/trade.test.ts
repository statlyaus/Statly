import { describe, expect, it } from 'vitest';
import type { BasketballCategoryId } from '@/types/basketball';
import { evaluateTrade } from './trade';

function z(values: Partial<Record<BasketballCategoryId, number>>) {
  return {
    categoryZ: {
      FG_PCT: 0,
      FT_PCT: 0,
      THREES: 0,
      PTS: 0,
      REB: 0,
      AST: 0,
      STL: 0,
      BLK: 0,
      TO: 0,
      ...values,
    },
  };
}

describe('evaluateTrade', () => {
  const give = [
    z({ PTS: 1, REB: 0.5, AST: -0.2, TO: -0.5 }),
    z({ PTS: 0.3, REB: 0.1, AST: 0.4, TO: 0.2 }),
  ];
  const get = [z({ PTS: 0.8, REB: 1.2, AST: 0.1, TO: -1, BLK: 3 })];

  it('nets each league category as get minus give and marks punts', () => {
    const result = evaluateTrade({
      give,
      get,
      categories: ['PTS', 'REB', 'AST', 'TO'],
      punts: ['AST'],
    });

    expect(
      result.categories.map((c) => [c.category, Number(c.net.toFixed(6)), c.verdict, c.punted])
    ).toEqual([
      ['PTS', -0.5, 'LOSS', false],
      ['REB', 0.6, 'GAIN', false],
      ['AST', -0.1, 'EVEN', true],
      ['TO', -0.7, 'LOSS', false],
    ]);
    expect(result.categories[0]).toMatchObject({ give: 1.3, get: 0.8 });
    // BLK is not a league category, so its +3 is ignored; AST is punted.
    expect(result.totalNet).toBeCloseTo(-0.6, 10);
    expect(result.summary).toEqual({ gains: 1, losses: 2, evens: 0 });
  });

  it('calls a net under 0.25 even and 0.25 or more a gain', () => {
    const result = evaluateTrade({
      give: [z({ PTS: 0.5, REB: 0.5 })],
      get: [z({ PTS: 0.74, REB: 0.75 })],
      categories: ['PTS', 'REB'],
    });
    expect(result.categories.map((c) => c.verdict)).toEqual(['EVEN', 'GAIN']);
  });

  it('totals nothing when every category is punted', () => {
    const result = evaluateTrade({ give, get, categories: ['PTS', 'REB'], punts: ['PTS', 'REB'] });
    expect(result.totalNet).toBe(0);
    expect(result.summary).toEqual({ gains: 0, losses: 0, evens: 0 });
  });
});
