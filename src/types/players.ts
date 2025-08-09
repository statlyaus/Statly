// src/types/players.ts
/**
 * Shared Statly types for players, rankings, and config.
 * Keep this file dependency-free so it can be imported from server/client.
 */

export type Numeric = number | null | undefined;

/**
 * Base shape of a player record coming from your data source.
 * - `stats` should contain raw season totals unless you explicitly pass per-game later.
 */
export type PlayerBase = {
  id: string;
  name: string;
  team?: string;
  position?: 'DEF' | 'MID' | 'FWD' | 'RUC' | string;
  games?: number;
  stats: Record<string, Numeric>;
};

/**
 * Minimal projection used by consumers (e.g., Trade Centre).
 * Includes computed rank & totalValue.
 */
export type PlayerWithRank = PlayerBase & {
  totalValue: number;
  rank: number; // 1 = best
};

/**
 * Calculator configuration for category selection and normalisation.
 */
export type CategoryConfig = {
  /** categories to include (keys must exist in player.stats) */
  categories: readonly string[];
  /** categories where lower is better (e.g., 'Clangers', 'Turnovers') */
  invert: readonly string[];
  /** include Disposal Efficiency % if data quality is OK */
  includeDE?: boolean;
  /** treat inputs as totals and convert to per-game (default true) */
  perGame?: boolean;
  /** winsorise tails at this probability (default 0.01 => 1% each tail) */
  winsorP?: number;
};

/**
 * The row shape returned by the rankings API for UI rendering/export.
 * Includes per-category z-scores for transparency/auditing.
 */
export type RankedPlayer = PlayerBase & {
  categoryScores: Record<string, number>;
  totalValue: number;
  rank: number;
};

/**
 * API response contract for /api/rankings
 */
export type RankingsResponse = {
  players: RankedPlayer[];
  categoriesUsed: string[];
  generatedAt: string; // ISO timestamp
  meta?: {
    excludedCategories?: Record<
      string,
      { reason: 'zeroVariance' | 'allMissing' | 'excludedByFlag'; mean: number; std: number }
    >;
    options?: {
      includeDE: boolean;
      perGame: boolean;
      winsorP: number;
    };
  };
};

/**
 * Default categories and inversions per your locked-in rules.
 * Note: 'Disposal Efficiency %' is conditionally included by `includeDE`.
 */
export const DEFAULT_CATEGORIES = [
  'Goals',
  'Goal Assists',
  'Tackles',
  'Clearances',
  'Inside 50s',
  'Rebound 50s',
  'Intercepts',
  'Contested Marks',
  'Metres Gained',
  'Score Involvements',
  'Effective Disposals',
  'Disposal Efficiency %', // optionally dropped if includeDE=false
  'Clangers',
  'Turnovers',
] as const;

export const INVERT_CATEGORIES = ['Clangers', 'Turnovers'] as const;