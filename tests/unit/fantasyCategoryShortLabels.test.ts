import { describe, expect, it } from 'vitest';

import { FANTASY_CATEGORIES, FANTASY_CATEGORY_KEYS } from '@/types/fantasyCategories';

describe('fantasy category short labels', () => {
  it('gives every category a unique short label so table headers are unambiguous', () => {
    const labels = FANTASY_CATEGORY_KEYS.map((key) => FANTASY_CATEGORIES[key].shortLabel);
    const duplicates = labels.filter((label, index) => labels.indexOf(label) !== index);

    expect(labels.every(Boolean)).toBe(true);
    expect(duplicates).toEqual([]);
  });

  it('abbreviates intercepts and clangers in AFL style', () => {
    expect(FANTASY_CATEGORIES.intercepts.shortLabel).toBe('ITC');
    expect(FANTASY_CATEGORIES.clangers.shortLabel).toBe('CG');
    expect(FANTASY_CATEGORIES.clearances.shortLabel).toBe('CL');
  });
});
