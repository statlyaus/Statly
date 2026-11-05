import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

// Rankings score the default league preset; it is defined once in fantasyCategories.
export const RANKING_CATEGORIES = REAL_DATA_NINE_CATEGORY_PRESET;
export type RankingCategory = (typeof RANKING_CATEGORIES)[number];

// Field name of each category in a Firestore player_match_stats `stats` map.
const STAT_FIELDS: Record<RankingCategory, string> = {
  goals: 'goals',
  tackles: 'tackles',
  inside50s: 'inside_50s',
  intercepts: 'intercepts',
  contestedMarks: 'contested_marks',
  rebound50s: 'rebound_50s',
  contestedPossessions: 'contested_possessions',
  effectiveDisposals: 'effective_disposals',
  scoreInvolvements: 'score_involvements',
};

export type CategoryValues = Record<RankingCategory, number | null>;
export type CategoryTotals = Record<RankingCategory, { sum: number; games: number }>;
export type CategoryScore = { perGame: number | null; zScore: number | null };

type MatchStatsDoc = {
  stats?: Record<string, unknown>;
  source_provenance?: Record<string, unknown>;
  [field: string]: unknown;
};

/**
 * Reads the preset categories from one match row. A stat the row does not hold is null.
 * Rows with `source_provenance` list every field a source supplied; `stats` fills the rest
 * with zeros (the source's "NA"), so a field missing from provenance is missing.
 */
export function readCategoryStats(data: MatchStatsDoc): CategoryValues {
  const provenance = data.source_provenance;
  return Object.fromEntries(
    RANKING_CATEGORIES.map((category) => {
      const field = STAT_FIELDS[category];
      if (provenance && !(field in provenance)) return [category, null];
      const value = data.stats?.[field] ?? data[field];
      return [category, typeof value === 'number' && Number.isFinite(value) ? value : null];
    })
  ) as CategoryValues;
}

export function emptyCategoryTotals(): CategoryTotals {
  return Object.fromEntries(
    RANKING_CATEGORIES.map((category) => [category, { sum: 0, games: 0 }])
  ) as CategoryTotals;
}

export function addCategoryStats(totals: CategoryTotals, values: CategoryValues): void {
  for (const category of RANKING_CATEGORIES) {
    const value = values[category];
    if (value === null) continue;
    totals[category].sum += value;
    totals[category].games += 1;
  }
}

// Shrinkage towards the league average so small samples don't dominate the z-scores
function shrinkToLeagueAverage(observed: number, games: number, leagueAvg: number, k = 3): number {
  const weight = games / (games + k);
  return weight * observed + (1 - weight) * leagueAvg;
}

/**
 * Per-game averages and z-scores per category. Players without data for a category get
 * null there, are left out of that category's average and add nothing to `overall`.
 */
export function scoreCategories<T extends { categoryTotals: CategoryTotals }>(
  players: T[]
): {
  players: Array<T & { categories: Record<RankingCategory, CategoryScore>; overall: number }>;
  averages: Record<RankingCategory, number | null>;
  stdDevs: Record<RankingCategory, number | null>;
} {
  const averages = {} as Record<RankingCategory, number | null>;
  const stdDevs = {} as Record<RankingCategory, number | null>;

  for (const category of RANKING_CATEGORIES) {
    const values = players
      .map((p) => p.categoryTotals[category])
      .filter((t) => t.games > 0)
      .map((t) => t.sum / t.games);
    if (values.length === 0) {
      averages[category] = null;
      stdDevs[category] = null;
      continue;
    }
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    averages[category] = mean;
    stdDevs[category] = Math.sqrt(
      values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
    );
  }

  return {
    averages,
    stdDevs,
    players: players.map((player) => {
      let overall = 0;
      const categories = {} as Record<RankingCategory, CategoryScore>;
      for (const category of RANKING_CATEGORIES) {
        const { sum, games } = player.categoryTotals[category];
        const mean = averages[category];
        const std = stdDevs[category];
        if (games === 0 || mean === null || std === null) {
          categories[category] = { perGame: null, zScore: null };
          continue;
        }
        const perGame = sum / games;
        const zScore = std === 0 ? 0 : (shrinkToLeagueAverage(perGame, games, mean) - mean) / std;
        categories[category] = { perGame, zScore };
        overall += zScore;
      }
      return { ...player, categories, overall };
    }),
  };
}

/** The requested season, or null when none (or nothing parseable) was requested. */
export function parseSeason(requested: string | null): number | null {
  const parsed = requested ? Number.parseInt(requested, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
