import { describe, expect, it } from 'vitest';

import {
  compareCategoryValues,
  normalizeCategoryDirections,
} from '@/server/leagues/categoryDirections';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

describe('category directions', () => {
  it('defaults selected categories to higher-is-better', () => {
    expect(normalizeCategoryDirections(REAL_DATA_NINE_CATEGORY_PRESET)).toEqual(
      Object.fromEntries(REAL_DATA_NINE_CATEGORY_PRESET.map((category) => [category, 'HIGH_WINS']))
    );
  });

  it('allows lower-is-better overrides for selected categories', () => {
    expect(normalizeCategoryDirections(['clangers'], { clangers: 'LOW_WINS' })).toEqual({
      clangers: 'LOW_WINS',
    });
  });

  it('compares category values by direction and supports draws', () => {
    expect(compareCategoryValues(10, 9, 'HIGH_WINS')).toBe('home');
    expect(compareCategoryValues(10, 9, 'LOW_WINS')).toBe('away');
    expect(compareCategoryValues(10, 10, 'LOW_WINS')).toBe('draw');
  });
});
