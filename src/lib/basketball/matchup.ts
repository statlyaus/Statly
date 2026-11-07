/**
 * Head-to-head week projection: actuals so far plus the simulated rest of the week, per-category
 * win chance and the chance of winning the matchup. Ported from the sheet's Weekly Projections.
 * Pure and isomorphic. See docs/domain/basketball.md, "Valuation and matchup maths".
 */

import {
  getBasketballCategory,
  type BasketballCategoryDefinition,
  type BasketballCategoryId,
  type BasketballRosterSlotCounts,
  type BasketballScoringFormat,
  type NbaStatLine,
} from '@/types/basketball';
import {
  countedGames,
  simulateLineups,
  type DailyLineup,
  type LineupDay,
  type LineupRosterEntry,
} from './lineupSimulator';
import { addStatLines, categoryValue, emptyStatLine, scaleStatLine } from './statLine';

/** A category is a toss-up when the gap is under 3 % of the larger total. */
export const TOSS_UP_BAND = 0.03;

/** Variance per unit of remaining volume for counting categories (sheet Weekly Projections). */
const COUNT_DISPERSION: Partial<Record<BasketballCategoryId, number>> = {
  THREES: 1.1,
  PTS: 2.5,
  REB: 1.2,
  AST: 1.1,
  STL: 1,
  BLK: 1.1,
  TO: 1,
};
const PROJECTION_ERROR = 0.06;
const PERCENT_OVERDISPERSION = 1.2;
const ATTEMPT_ERROR = 0.02;

export type CategoryCall = 'WIN' | 'LOSS' | 'TOSS_UP';

export interface CategoryComparison {
  category: BasketballCategoryId;
  me: number;
  opponent: number;
  /** Positive when I am ahead: `me − opponent`, or `opponent − me` for a low-wins category. */
  margin: number;
  call: CategoryCall;
}

/** The deterministic comparison: margin and the 3 % toss-up call. */
export function compareCategory(
  me: NbaStatLine,
  opponent: NbaStatLine,
  categoryId: BasketballCategoryId
): CategoryComparison {
  const category = getBasketballCategory(categoryId);
  const mine = categoryValue(me, category);
  const theirs = categoryValue(opponent, category);
  const margin = category.direction === 'LOW_WINS' ? theirs - mine : mine - theirs;
  const gap = Math.abs(mine - theirs) / Math.max(Math.abs(mine), Math.abs(theirs), 1e-6);
  const call = gap < TOSS_UP_BAND ? 'TOSS_UP' : margin > 0 ? 'WIN' : 'LOSS';
  return { category: categoryId, me: mine, opponent: theirs, margin, call };
}

/** Standard normal CDF, Abramowitz–Stegun 26.2.17 (|error| < 7.5e-8), as the sheet's script uses. */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const density = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const tail =
    density *
    t *
    (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - tail : tail;
}

export interface MatchupOutcome {
  /** Wins more than half the categories. */
  win: number;
  /** Wins exactly half (only possible with an even number of categories). */
  tie: number;
  loss: number;
}

/** Poisson-binomial distribution of categories won, from independent per-category chances. */
export function matchupOutcome(winChances: readonly number[]): MatchupOutcome {
  let distribution = [1];
  for (const p of winChances) {
    const next = Array.from({ length: distribution.length + 1 }, () => 0);
    distribution.forEach((probability, won) => {
      next[won] += probability * (1 - p);
      next[won + 1] += probability * p;
    });
    distribution = next;
  }
  const half = winChances.length / 2;
  const sum = (keep: (won: number) => boolean) =>
    distribution.reduce((total, probability, won) => total + (keep(won) ? probability : 0), 0);
  return {
    win: sum((won) => won > half),
    tie: sum((won) => won === half),
    loss: sum((won) => won < half),
  };
}

/** One side's variance contribution to a category margin, from its remaining volume. */
function sideVariance(
  category: BasketballCategoryDefinition,
  rest: NbaStatLine,
  total: NbaStatLine
): number {
  if (category.kind === 'COUNT') {
    const remaining = rest[category.stat];
    return (COUNT_DISPERSION[category.id] ?? 1) * remaining + (PROJECTION_ERROR * remaining) ** 2;
  }
  const remaining = rest[category.attempted];
  const attempts = total[category.attempted];
  const p = attempts > 0 ? total[category.made] / attempts : 0;
  const sd =
    Math.sqrt(remaining * p * (1 - p) * PERCENT_OVERDISPERSION + (ATTEMPT_ERROR * remaining) ** 2) /
    Math.max(attempts, 1);
  return sd * sd;
}

export interface MatchupSide {
  roster: readonly LineupRosterEntry[];
  /** Per-game projection by player id; a player without one is left out of the lineup. */
  perGame: Readonly<Record<string, NbaStatLine>>;
  /** Stats already counted this week (see `countedActuals`). */
  actual: NbaStatLine;
}

export interface RestOfWeek {
  restOfWeek: NbaStatLine;
  /** Remaining counted games by player id. */
  gamesLeft: Record<string, number>;
  lineups: DailyLineup[];
}

export interface SideProjection extends RestOfWeek {
  actual: NbaStatLine;
  total: NbaStatLine;
}

/**
 * Per-game lines times the games each player is simulated to start on the given days. A rostered
 * player with no per-game line (no games in either season) is left out of the lineup, so he never
 * takes a slot from a bench player who has a projection.
 */
export function projectRestOfWeek(input: {
  roster: readonly LineupRosterEntry[];
  perGame: Readonly<Record<string, NbaStatLine>>;
  slots: BasketballRosterSlotCounts;
  days: readonly LineupDay[];
}): RestOfWeek {
  const lineups = simulateLineups({
    roster: input.roster.filter((player) => input.perGame[player.playerId]),
    slots: input.slots,
    days: input.days,
  });
  const gamesLeft = countedGames(lineups);
  const restOfWeek = Object.entries(gamesLeft).reduce(
    (total, [playerId, games]) =>
      addStatLines(total, scaleStatLine(input.perGame[playerId], games)),
    emptyStatLine()
  );
  return { restOfWeek, gamesLeft, lineups };
}

export interface CategoryProjection extends CategoryComparison {
  /** Standard deviation of the margin. 0 when nothing is left to play. */
  sigma: number;
  /** `Φ(margin / σ)`; with σ = 0, 1, 0 or 0.5 by the margin's sign. */
  winChance: number;
}

export interface MatchupProjection {
  me: SideProjection;
  opponent: SideProjection;
  categories: CategoryProjection[];
  /** Counts of the deterministic calls (the projected W-L-T). */
  calls: { wins: number; losses: number; tossUps: number };
  /** Σ win chance: the expected record for an each-category league. */
  expectedCategoriesWon: number;
  expectedCategoriesLost: number;
  /** Matchup win, tie and loss chance; null for `H2H_EACH_CATEGORY`, where each category counts. */
  outcome: MatchupOutcome | null;
}

export function projectMatchup(input: {
  categories: readonly BasketballCategoryId[];
  format: BasketballScoringFormat;
  slots: BasketballRosterSlotCounts;
  /** The dates still to play this week, with the players whose teams play each date. */
  remainingDays: readonly LineupDay[];
  me: MatchupSide;
  opponent: MatchupSide;
}): MatchupProjection {
  const side = (team: MatchupSide): SideProjection => {
    const rest = projectRestOfWeek({ ...team, slots: input.slots, days: input.remainingDays });
    return { ...rest, actual: team.actual, total: addStatLines(team.actual, rest.restOfWeek) };
  };
  const me = side(input.me);
  const opponent = side(input.opponent);

  const categories = input.categories.map((categoryId): CategoryProjection => {
    const category = getBasketballCategory(categoryId);
    const comparison = compareCategory(me.total, opponent.total, categoryId);
    const sigma = Math.sqrt(
      sideVariance(category, me.restOfWeek, me.total) +
        sideVariance(category, opponent.restOfWeek, opponent.total)
    );
    const winChance =
      sigma > 0
        ? normalCdf(comparison.margin / sigma)
        : comparison.margin > 0
          ? 1
          : comparison.margin < 0
            ? 0
            : 0.5;
    return { ...comparison, sigma, winChance };
  });

  const count = (call: CategoryCall) => categories.filter((c) => c.call === call).length;
  const expectedCategoriesWon = categories.reduce((sum, c) => sum + c.winChance, 0);
  return {
    me,
    opponent,
    categories,
    calls: { wins: count('WIN'), losses: count('LOSS'), tossUps: count('TOSS_UP') },
    expectedCategoriesWon,
    expectedCategoriesLost: categories.length - expectedCategoriesWon,
    outcome:
      input.format === 'H2H_MOST_CATEGORIES'
        ? matchupOutcome(categories.map((c) => c.winChance))
        : null,
  };
}
