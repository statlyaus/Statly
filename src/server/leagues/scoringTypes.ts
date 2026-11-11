import type { FantasyCategoryKey } from '@/types/fantasyCategories';

export type LeagueScoringMode = 'H2H_EACH_CATEGORY' | 'H2H_MOST_CATEGORIES';
export type ActiveLineupSlot = 'FWD' | 'DEF' | 'MID' | 'RUC' | 'UTIL';
export type LeagueLineupSlot = ActiveLineupSlot | 'INTERCHANGE' | 'BENCH';
export type CategoryDirection = 'HIGH_WINS' | 'LOW_WINS';

export type LineupSlotSettings = Record<ActiveLineupSlot, number>;

/** A ratio category's round inputs, e.g. DE%'s effective disposals over disposals. */
export type RatioParts = { numerator: number; denominator: number };

export type CategoryScoreResult = {
  category: FantasyCategoryKey;
  /** Null when the side has no value, such as DE% for a team with no disposals. */
  homeValue: number | null;
  awayValue: number | null;
  /** Ratio categories only: each side's numerator and denominator, so a season can be pooled. */
  homeRatio?: RatioParts;
  awayRatio?: RatioParts;
  direction: CategoryDirection;
  winner: 'home' | 'away' | 'draw';
};

export interface MatchupScoreResult {
  homeCategoryWins: number;
  awayCategoryWins: number;
  drawnCategories: number;
  homeMatchupWin: boolean;
  awayMatchupWin: boolean;
  matchupDraw: boolean;
  categories: CategoryScoreResult[];
}
