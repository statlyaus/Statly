import type { FantasyCategoryKey } from '@/types/fantasyCategories';

import { compareCategoryValues } from './categoryDirections';
import type {
  CategoryDirection,
  LeagueLineupSlot,
  LeagueScoringMode,
  MatchupScoreResult,
} from './scoringTypes';

export type CategoryTotals = Partial<Record<FantasyCategoryKey, number>>;

export interface LineupScoringPlayer {
  playerId: string;
  slot: LeagueLineupSlot;
  totals: CategoryTotals;
}

export interface AggregateLineupCategoryTotalsInput {
  categories: readonly FantasyCategoryKey[];
  players: readonly LineupScoringPlayer[];
}

export interface ScoreHeadToHeadCategoriesInput {
  categories: readonly FantasyCategoryKey[];
  categoryDirections: Partial<Record<FantasyCategoryKey, CategoryDirection>>;
  homeTotals: CategoryTotals;
  awayTotals: CategoryTotals;
  scoringMode: LeagueScoringMode;
}

function readTotal(totals: CategoryTotals, category: FantasyCategoryKey): number {
  const value = totals[category];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function aggregateLineupCategoryTotals(
  input: AggregateLineupCategoryTotalsInput
): CategoryTotals {
  const totals: CategoryTotals = {};

  for (const category of input.categories) {
    totals[category] = 0;
  }

  for (const player of input.players) {
    if (player.slot === 'BENCH') continue;

    for (const category of input.categories) {
      totals[category] = readTotal(totals, category) + readTotal(player.totals, category);
    }
  }

  return totals;
}

export function sumCategoryTotals(
  totals: CategoryTotals,
  categories: readonly FantasyCategoryKey[]
): number {
  return categories.reduce((sum, category) => sum + readTotal(totals, category), 0);
}

export function scoreHeadToHeadCategories(
  input: ScoreHeadToHeadCategoriesInput
): MatchupScoreResult {
  let homeCategoryWins = 0;
  let awayCategoryWins = 0;
  let drawnCategories = 0;

  const categories = input.categories.map((category) => {
    const homeValue = readTotal(input.homeTotals, category);
    const awayValue = readTotal(input.awayTotals, category);
    const direction = input.categoryDirections[category] ?? 'HIGH_WINS';
    const winner = compareCategoryValues(homeValue, awayValue, direction);

    if (winner === 'home') homeCategoryWins += 1;
    if (winner === 'away') awayCategoryWins += 1;
    if (winner === 'draw') drawnCategories += 1;

    return { category, homeValue, awayValue, direction, winner };
  });

  const homeMatchupWin = homeCategoryWins > awayCategoryWins;
  const awayMatchupWin = awayCategoryWins > homeCategoryWins;
  const matchupDraw = homeCategoryWins === awayCategoryWins;

  return {
    homeCategoryWins,
    awayCategoryWins,
    drawnCategories,
    homeMatchupWin,
    awayMatchupWin,
    matchupDraw,
    categories,
  };
}
