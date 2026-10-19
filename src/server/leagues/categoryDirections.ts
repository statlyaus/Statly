import type { FantasyCategoryKey } from '@/types/fantasyCategories';

import type { CategoryDirection } from './scoringTypes';

export function normalizeCategoryDirections(
  categories: readonly FantasyCategoryKey[],
  input?: unknown
): Record<FantasyCategoryKey, CategoryDirection> {
  const source =
    input && typeof input === 'object'
      ? (input as Partial<Record<FantasyCategoryKey, unknown>>)
      : {};
  return Object.fromEntries(
    categories.map((category) => [
      category,
      source[category] === 'LOW_WINS' ? 'LOW_WINS' : 'HIGH_WINS',
    ])
  ) as Record<FantasyCategoryKey, CategoryDirection>;
}

export function compareCategoryValues(
  homeValue: number,
  awayValue: number,
  direction: CategoryDirection
): 'home' | 'away' | 'draw' {
  if (homeValue === awayValue) return 'draw';
  if (direction === 'LOW_WINS') return homeValue < awayValue ? 'home' : 'away';
  return homeValue > awayValue ? 'home' : 'away';
}
