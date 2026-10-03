import type { ReactElement } from 'react';

import { FANTASY_CATEGORIES, isFantasyCategoryKey } from '@/types/fantasyCategories';

import { CategoryBoxScore, type BoxScoreCategory } from './MatchupScore';

/**
 * The category box score with nothing scored yet: one column per scoring category, so a league
 * shows how a weekly head-to-head will read before any fixture exists. It carries no values.
 */
export function CategoryPreviewScore({
  categories,
}: {
  categories: readonly string[];
}): ReactElement | null {
  const previewCategories: BoxScoreCategory[] = categories
    .filter(isFantasyCategoryKey)
    .map((key) => {
      const category = FANTASY_CATEGORIES[key];
      return {
        key,
        label: category.label,
        shortLabel: category.shortLabel ?? category.label,
        result: 'pending',
        yourValue: null,
        opponentValue: null,
      };
    });

  if (previewCategories.length === 0) return null;

  return (
    <CategoryBoxScore
      caption="Preview of your weekly matchup, no fixtures yet"
      categories={previewCategories}
    />
  );
}
