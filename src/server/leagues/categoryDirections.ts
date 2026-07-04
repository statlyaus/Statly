import type { FantasyCategoryKey } from '@/types/fantasyCategories';

import type { CategoryDirection } from './scoringTypes';

export function normalizeCategoryDirections(
  categories: readonly FantasyCategoryKey[],
  input?: Partial<Record<FantasyCategoryKey, string | CategoryDirection>>
): Record<FantasyCategoryKey, CategoryDirection> {
  return Object.fromEntries(
    categories.map((category) => [
      category,
      input?.[category] === 'LOW_WINS' ? 'LOW_WINS' : 'HIGH_WINS',
    ])
  ) as Record<FantasyCategoryKey, CategoryDirection>;
}

export function parseCategoryDirectionsJson(
  categories: readonly FantasyCategoryKey[],
  value: string | null | undefined
): Record<FantasyCategoryKey, CategoryDirection> {
  if (!value) return normalizeCategoryDirections(categories);

  try {
    return normalizeCategoryDirections(categories, JSON.parse(value));
  } catch {
    return normalizeCategoryDirections(categories);
  }
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
