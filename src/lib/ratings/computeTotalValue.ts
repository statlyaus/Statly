// src/lib/Ratings/computeTotalValue.ts
'use client';
/**
 * Statly - Total Value calculator
 * - Per-game z-score normalisation with equal weighting
 * - Winsorises 1% tails to reduce outlier distortion
 * - Inverts "bad" stats so higher is always better
 * - Optional inclusion of Disposal Efficiency %
 *
 * PSR-12-ish TypeScript style, strict-friendly, no side effects.
 */

export type Numeric = number | null | undefined;

export type PlayerBase = {
  id: string;
  name: string;
  team?: string;
  // Raw totals for the season (or per-game if you prefer to feed it that way)
  games?: number;
  // Flexible bag of numeric stats (totals); keys must match chosen categories.
  stats: Record<string, Numeric>;
};

export type CategoryConfig = {
  /** categories to include (keys must exist in player.stats, or be safely coercible to number) */
  categories: string[];
  /** categories where lower is better (e.g., 'Clangers', 'Turnovers') */
  invert: string[];
  /** include Disposal Efficiency % if data quality is OK */
  includeDE?: boolean;
  /** treat inputs as totals and convert to per-game (default true) */
  perGame?: boolean;
  /** winsorise tails at this probability (default 0.01 => 1% each tail) */
  winsorP?: number;
};

export type CategoryStats = {
  mean: number;
  std: number; // population std (STDEV.P)
  used: boolean;
  reason?: 'zeroVariance' | 'allMissing' | 'excludedByFlag';
};

export type PlayerWithScores = PlayerBase & {
  categoryScores: Record<string, number>; // z-scores after inversion
  totalValue: number; // average of included category z-scores
  rank: number; // 1 = best
};

export type ComputeResult = {
  players: PlayerWithScores[];
  meta: {
    categoriesUsed: string[];
    categoryStats: Record<string, CategoryStats>;
    excludedCategories: Record<string, CategoryStats>;
    options: Required<Omit<CategoryConfig, 'includeDE'>> & { includeDE: boolean };
  };
};

function isFiniteNumber(x: Numeric): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function winsorise(values: number[], p: number): number[] {
  if (values.length === 0) return values;
  const arr = [...values].sort((a, b) => a - b);
  const lo = quantile(arr, p);
  const hi = quantile(arr, 1 - p);
  return values.map((v) => Math.min(hi, Math.max(lo, v)));
}

/**
 * Convert raw totals to per-game if requested.
 */
function toPerGame(v: Numeric, games: Numeric, perGame: boolean): number | null {
  if (!perGame) return isFiniteNumber(v) ? v : null;
  if (!isFiniteNumber(v) || !isFiniteNumber(games) || games <= 0) return null;
  return v / games;
}

/**
 * Compute population mean and std (ddof = 0).
 */
function popMeanStd(xs: number[]): { mean: number; std: number } {
  if (xs.length === 0) return { mean: NaN, std: NaN };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const varp = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return { mean, std: Math.sqrt(varp) };
}

/**
 * Main entry: compute Total Value & rank.
 */
export function computeTotalValue(
  players: PlayerBase[],
  cfg: CategoryConfig
): ComputeResult {
  const options = {
    perGame: cfg.perGame ?? true,
    winsorP: cfg.winsorP ?? 0.01,
    includeDE: cfg.includeDE ?? false,
    categories: [...cfg.categories],
    invert: [...cfg.invert],
  };

  // Optionally drop 'Disposal Efficiency %' if includeDE=false
  const deKey = 'Disposal Efficiency %';
  let categories = [...options.categories];
  if (!options.includeDE) {
    categories = categories.filter((c) => c !== deKey);
  }

  const categoryStats: Record<string, CategoryStats> = {};
  const excludedCategories: Record<string, CategoryStats> = {};

  // Prepare per-category arrays (per-game if requested) and winsorise
  for (const cat of categories) {
    // Gather values
    const raw: number[] = players
      .map((p) => toPerGame(p.stats[cat], p.games, options.perGame))
      .filter(isFiniteNumber) as number[];

    if (raw.length === 0) {
      const meta: CategoryStats = { mean: NaN, std: NaN, used: false, reason: 'allMissing' };
      categoryStats[cat] = meta;
      excludedCategories[cat] = meta;
      continue;
    }

    const w = options.winsorP > 0 ? winsorise(raw, options.winsorP) : raw;
    const { mean, std } = popMeanStd(w);

    if (!Number.isFinite(std) || std === 0) {
      const meta: CategoryStats = { mean, std: std || 0, used: false, reason: 'zeroVariance' };
      categoryStats[cat] = meta;
      excludedCategories[cat] = meta;
      continue;
    }

    categoryStats[cat] = { mean, std, used: true };
  }

  // Categories we can actually use (non-zero variance, non-missing)
  const categoriesUsed = categories.filter((c) => categoryStats[c]?.used);

  // Build z-scores per player
  const scored: PlayerWithScores[] = players.map((p) => {
    const categoryScores: Record<string, number> = {};
    let sum = 0;
    let n = 0;

    for (const cat of categoriesUsed) {
      const valPG = toPerGame(p.stats[cat], p.games, options.perGame);
      if (!isFiniteNumber(valPG)) continue;

      const { mean, std } = categoryStats[cat];
      const z = (valPG - mean) / (std || 1); // std=0 guarded earlier
      const zAdj = options.invert.includes(cat) ? -z : z;

      categoryScores[cat] = zAdj;
      sum += zAdj;
      n += 1;
    }

    const totalValue = n > 0 ? sum / n : 0;

    return {
      ...p,
      categoryScores,
      totalValue,
      rank: 0, // placeholder, set after we compute all totals
    };
  });

  // Rank (1 = best). Keep stable for ties using "min" style.
  const sorted = [...scored].sort((a, b) => b.totalValue - a.totalValue);
  let currentRank = 0;
  let lastValue: number | null = null;
  let seen = 0;

  for (const row of sorted) {
    seen += 1;
    if (lastValue === null || row.totalValue !== lastValue) {
      currentRank = seen;
      lastValue = row.totalValue;
    }
    const target = scored.find((p) => p.id === row.id)!;
    target.rank = currentRank;
  }

  return {
    players: scored,
    meta: {
      categoriesUsed,
      categoryStats,
      excludedCategories,
      options,
    },
  };
}

/**
 * Small convenience: default config builder for your locked-in rules.
 */
export function defaultCategoryConfig(includeDE = false): CategoryConfig {
  return {
    categories: [
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
      'Disposal Efficiency %', // will be dropped if includeDE=false
      'Clangers',
      'Turnovers',
    ],
    invert: ['Clangers', 'Turnovers'],
    includeDE,
    perGame: true,
    winsorP: 0.01,
  };
}