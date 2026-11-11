import {
  categoryAggregation,
  type FantasyCategoryKey,
  type ScoringStatKey,
} from '@/types/fantasyCategories';

import { compareCategoryValues } from './categoryDirections';
import type {
  CategoryDirection,
  LeagueLineupSlot,
  LeagueScoringMode,
  MatchupScoreResult,
  RatioParts,
} from './scoringTypes';

/**
 * A player's or a team's values by stat. A player's totals also carry `disposals`, which is not a
 * category but is what team disposal efficiency is computed from. An absent value is unavailable.
 */
export type CategoryTotals = Partial<Record<ScoringStatKey, number>>;

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

function readTotal(totals: CategoryTotals, key: ScoringStatKey): number {
  const value = totals[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * A team's value per category across its counted players (bench and interchange excluded). Each
 * category's aggregation rule lives on its definition in `fantasyCategories.ts`: most categories
 * sum; disposal efficiency is total effective disposals / total disposals x 100, and is left out
 * (unavailable) when the team had no disposals. A ratio's numerator and denominator totals are kept
 * too, so the round's result can store them for a season ratio.
 */
export function aggregateLineupCategoryTotals(
  input: AggregateLineupCategoryTotalsInput
): CategoryTotals {
  const counted = input.players.filter(
    (player) => player.slot !== 'BENCH' && player.slot !== 'INTERCHANGE'
  );
  const sumOf = (key: ScoringStatKey) =>
    counted.reduce((sum, player) => sum + readTotal(player.totals, key), 0);
  const totals: CategoryTotals = {};

  for (const category of input.categories) {
    const aggregation = categoryAggregation(category);
    if (aggregation.kind === 'sum') {
      totals[category] = sumOf(category);
      continue;
    }
    const numerator = sumOf(aggregation.numerator);
    const denominator = sumOf(aggregation.denominator);
    totals[aggregation.numerator] = numerator;
    totals[aggregation.denominator] = denominator;
    if (denominator > 0) {
      totals[category] = (numerator / denominator) * aggregation.scale;
    }
  }

  return totals;
}

/** A ratio category's value is unavailable (null) when its denominator was 0. */
function readCategoryValue(totals: CategoryTotals, category: FantasyCategoryKey): number | null {
  if (categoryAggregation(category).kind === 'sum') return readTotal(totals, category);
  const value = totals[category];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readRatioParts(totals: CategoryTotals, category: FantasyCategoryKey): RatioParts | null {
  const aggregation = categoryAggregation(category);
  if (aggregation.kind !== 'ratio') return null;
  return {
    numerator: readTotal(totals, aggregation.numerator),
    denominator: readTotal(totals, aggregation.denominator),
  };
}

/**
 * `pointsFor`: the team's count categories added together. A ratio category (DE%) is a rate, not
 * a count, so it is left out rather than added to goals and tackles.
 */
export function sumCategoryTotals(
  totals: CategoryTotals,
  categories: readonly FantasyCategoryKey[]
): number {
  return categories.reduce(
    (sum, category) =>
      categoryAggregation(category).kind === 'sum' ? sum + readTotal(totals, category) : sum,
    0
  );
}

export function scoreHeadToHeadCategories(
  input: ScoreHeadToHeadCategoriesInput
): MatchupScoreResult {
  let homeCategoryWins = 0;
  let awayCategoryWins = 0;
  let drawnCategories = 0;

  const categories = input.categories.map((category) => {
    const homeValue = readCategoryValue(input.homeTotals, category);
    const awayValue = readCategoryValue(input.awayTotals, category);
    const direction = input.categoryDirections[category] ?? 'HIGH_WINS';
    // A side with no value (a team with no disposals has no DE%) cannot win or lose the category.
    const winner =
      homeValue === null || awayValue === null
        ? 'draw'
        : compareCategoryValues(homeValue, awayValue, direction);

    if (winner === 'home') homeCategoryWins += 1;
    if (winner === 'away') awayCategoryWins += 1;
    if (winner === 'draw') drawnCategories += 1;

    const homeRatio = readRatioParts(input.homeTotals, category);
    const awayRatio = readRatioParts(input.awayTotals, category);
    return {
      category,
      homeValue,
      awayValue,
      ...(homeRatio && awayRatio ? { homeRatio, awayRatio } : {}),
      direction,
      winner,
    };
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
