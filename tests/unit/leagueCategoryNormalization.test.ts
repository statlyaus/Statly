import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FANTASY_CATEGORIES,
  formatStatValue,
  normalizeFantasyCategoryKeys,
  type FantasyCategoryKey,
} from '@/types/fantasyCategories';

const ACCEPTANCE_CATEGORIES = [
  'goals',
  'tackles',
  'inside50s',
  'intercepts',
  'contestedMarks',
  'rebound50s',
  'contestedPossessions',
  'effectiveDisposals',
  'scoreInvolvements',
] as const satisfies readonly FantasyCategoryKey[];

describe('league category source of truth', () => {
  it('preserves the configured order and derives the required abbreviations', () => {
    const categories = normalizeFantasyCategoryKeys([...ACCEPTANCE_CATEGORIES, 'goals', 'unknown']);

    expect(categories).toEqual(ACCEPTANCE_CATEGORIES);
    expect(categories.map((category) => FANTASY_CATEGORIES[category].shortLabel)).toEqual([
      'G',
      'T',
      'I50',
      'I',
      'CM',
      'R50',
      'CP',
      'ED',
      'SI',
    ]);
  });

  it('formats per-game averages without conflating missing data and zero', () => {
    expect(formatStatValue(0, FANTASY_CATEGORIES.goals)).toBe('0.0');
    expect(formatStatValue(1.44, FANTASY_CATEGORIES.goals)).toBe('1.4');
    expect(formatStatValue(74.24, FANTASY_CATEGORIES.disposalEffPct)).toBe('74.2%');
    expect(formatStatValue(null, FANTASY_CATEGORIES.goals)).toBe('—');
    expect(formatStatValue(Number.NaN, FANTASY_CATEGORIES.goals)).toBe('—');
  });

  it.each([
    'src/server/leagues/leagueDetail.ts',
    'src/app/api/leagues/[id]/settings/route.ts',
    'src/app/api/leagues/user/[userId]/route.ts',
    'src/server/leagues/matchupReadModel.ts',
  ])('uses the shared full-registry normalizer in %s', (relativePath) => {
    const source = readFileSync(join(process.cwd(), relativePath), 'utf8');

    expect(source).toContain('normalizeFantasyCategoryKeys');
    expect(source).not.toContain('REAL_DATA_CATEGORY_KEYS');
  });
});
