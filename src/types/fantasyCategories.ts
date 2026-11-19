export type FantasyCategoryKey =
  | 'goals'
  | 'kicks'
  | 'handballs'
  | 'marks'
  | 'tackles'
  | 'hitouts'
  | 'clearances'
  | 'inside50s'
  | 'rebound50s'
  | 'clangers'
  | 'contestedPossessions'
  | 'uncontestedPossessions'
  | 'freesFor'
  | 'freesAgainst'
  | 'onePercenters'
  | 'goalAssists'
  | 'timeOnGroundPct'
  | 'disposalEffPct'
  | 'turnovers'
  | 'intercepts'
  | 'metresGained'
  | 'contestedMarks'
  | 'effectiveDisposals'
  | 'scoreInvolvements';

/** A per-player stat a team's category value is computed from: a category, or disposals. */
export type ScoringStatKey = FantasyCategoryKey | 'disposals';

/**
 * How a team's value for a category is built from its counted players. `sum` (the default) adds
 * the players' values. `ratio` is sum(numerator) / sum(denominator) x scale, and is unavailable
 * when the denominator sums to 0.
 */
export type CategoryAggregation =
  | { kind: 'sum' }
  | { kind: 'ratio'; numerator: ScoringStatKey; denominator: ScoringStatKey; scale: number };

export interface FantasyCategory {
  id: FantasyCategoryKey;
  label: string;
  shortLabel?: string;
  abbrev?: string; // For backward compatibility
  format: 'number' | 'percentage' | 'decimal';
  color?: 'red' | 'green' | 'blue' | 'orange' | 'purple' | 'yellow';
  description?: string;
  /** Defaults to `sum`. */
  aggregation?: CategoryAggregation;
  /** False for a stat shown for display that a league cannot score. Defaults to true. */
  selectable?: false;
}

export interface PlayerStats {
  games: number;
  kicks: number;
  handballs: number;
  marks: number;
  tackles: number;
  goals: number;
  hitouts: number;
  clearances: number;
  inside50s: number;
  rebound50s: number;
  clangers: number;
  contestedPossessions: number;
  uncontestedPossessions: number;
  freesFor: number;
  freesAgainst: number;
  onePercenters: number;
  goalAssists: number;
  timeOnGroundPct: number; // 0–100
  disposalEffPct: number; // 0–100
  turnovers: number;
  intercepts: number;
  metresGained: number;
  contestedMarks: number;
  effectiveDisposals: number;
  scoreInvolvements: number;
  // Legacy fields for compatibility
  seasonTotal?: number;
  avgFantasyPoints?: number;
  lastGameFantasyPoints?: number;
}

export interface LeagueSettings {
  id?: string;
  name?: string;
  selectedCategories: FantasyCategoryKey[];
  categoryWeights?: Record<FantasyCategoryKey, number>;
  maxCategories?: number;
  scoringType?: string;
}

export const REAL_DATA_NINE_CATEGORY_PRESET = [
  'goals',
  'tackles',
  'inside50s',
  'intercepts',
  'contestedMarks',
  'rebound50s',
  'contestedPossessions',
  'effectiveDisposals',
  'scoreInvolvements',
] as const satisfies readonly FantasyCategoryKey[];

export const FANTASY_CATEGORIES: Record<FantasyCategoryKey, FantasyCategory> = {
  goals: {
    id: 'goals',
    label: 'Goals',
    shortLabel: 'G',
    abbrev: 'G',
    format: 'number',
    color: 'green',
    description: 'Goals scored',
  },
  kicks: {
    id: 'kicks',
    label: 'Kicks',
    shortLabel: 'K',
    abbrev: 'K',
    format: 'number',
    color: 'blue',
    description: 'Kicks',
  },
  handballs: {
    id: 'handballs',
    label: 'Handballs',
    shortLabel: 'HB',
    abbrev: 'HB',
    format: 'number',
    color: 'blue',
    description: 'Handballs',
  },
  marks: {
    id: 'marks',
    label: 'Marks',
    shortLabel: 'M',
    abbrev: 'M',
    format: 'number',
    color: 'green',
    description: 'Marks taken',
  },
  tackles: {
    id: 'tackles',
    label: 'Tackles',
    shortLabel: 'T',
    abbrev: 'T',
    format: 'number',
    color: 'red',
    description: 'Tackles made',
  },
  hitouts: {
    id: 'hitouts',
    label: 'Hitouts',
    shortLabel: 'HO',
    abbrev: 'HO',
    format: 'number',
    color: 'purple',
    description: 'Ruck contests won',
  },
  clearances: {
    id: 'clearances',
    label: 'Clearances',
    shortLabel: 'CL',
    abbrev: 'CL',
    format: 'number',
    color: 'orange',
    description: 'Clearances won',
  },
  inside50s: {
    id: 'inside50s',
    label: 'Inside 50s',
    shortLabel: 'I50',
    abbrev: 'I50',
    format: 'number',
    color: 'orange',
    description: 'Disposals into attacking 50m zone',
  },
  rebound50s: {
    id: 'rebound50s',
    label: 'Rebound 50s',
    shortLabel: 'R50',
    abbrev: 'R50',
    format: 'number',
    color: 'blue',
    description: 'Disposals from defensive 50m zone',
  },
  clangers: {
    id: 'clangers',
    label: 'Clangers',
    shortLabel: 'CG',
    abbrev: 'CG',
    format: 'number',
    color: 'red',
    description: 'Skill errors that directly benefit the opposition',
  },
  contestedPossessions: {
    id: 'contestedPossessions',
    label: 'Contested Possessions',
    shortLabel: 'CP',
    abbrev: 'CP',
    format: 'number',
    color: 'red',
    description: 'Possessions won in contested situations',
  },
  uncontestedPossessions: {
    id: 'uncontestedPossessions',
    label: 'Uncontested Possessions',
    shortLabel: 'UP',
    abbrev: 'UP',
    format: 'number',
    color: 'blue',
    description: 'Possessions won in uncontested situations',
  },
  freesFor: {
    id: 'freesFor',
    label: 'Frees For',
    shortLabel: 'FF',
    abbrev: 'FF',
    format: 'number',
    color: 'green',
    description: 'Free kicks received',
  },
  freesAgainst: {
    id: 'freesAgainst',
    label: 'Frees Against',
    shortLabel: 'FA',
    abbrev: 'FA',
    format: 'number',
    color: 'red',
    description: 'Free kicks conceded',
  },
  onePercenters: {
    id: 'onePercenters',
    label: 'One Percenters',
    shortLabel: '1%',
    abbrev: '1%',
    format: 'number',
    color: 'purple',
    description: 'Defensive actions that prevent scoring',
  },
  goalAssists: {
    id: 'goalAssists',
    label: 'Goal Assists',
    shortLabel: 'GA',
    abbrev: 'GA',
    format: 'number',
    color: 'green',
    description: 'Assists that lead directly to goals',
  },
  timeOnGroundPct: {
    id: 'timeOnGroundPct',
    label: 'Time on Ground %',
    shortLabel: 'TOG%',
    abbrev: 'TOG%',
    format: 'percentage',
    color: 'yellow',
    description: 'Percentage of game time on ground',
    // Owner decision 2026-11-11: shown for display, never a scoring category.
    selectable: false,
  },
  disposalEffPct: {
    id: 'disposalEffPct',
    label: 'Disposal Efficiency %',
    shortLabel: 'DE%',
    abbrev: 'DE%',
    format: 'percentage',
    color: 'blue',
    description: 'Percentage of disposals that reach their target',
    // Owner decision 2026-11-11: a team's DE% is its effective disposals over its disposals.
    aggregation: {
      kind: 'ratio',
      numerator: 'effectiveDisposals',
      denominator: 'disposals',
      scale: 100,
    },
  },
  turnovers: {
    id: 'turnovers',
    label: 'Turnovers',
    shortLabel: 'TO',
    abbrev: 'TO',
    format: 'number',
    color: 'red',
    description: 'Possession losses',
  },
  intercepts: {
    id: 'intercepts',
    label: 'Intercepts',
    shortLabel: 'ITC',
    abbrev: 'ITC',
    format: 'number',
    color: 'green',
    description: 'Possessions gained from opposition',
  },
  metresGained: {
    id: 'metresGained',
    label: 'Metres Gained',
    shortLabel: 'MG',
    abbrev: 'MG',
    format: 'number',
    color: 'green',
    description: 'Metres gained through disposals',
  },
  contestedMarks: {
    id: 'contestedMarks',
    label: 'Contested Marks',
    shortLabel: 'CM',
    abbrev: 'CM',
    format: 'number',
    color: 'purple',
    description: 'Marks taken in contested situations',
  },
  effectiveDisposals: {
    id: 'effectiveDisposals',
    label: 'Effective Disposals',
    shortLabel: 'ED',
    abbrev: 'ED',
    format: 'number',
    color: 'green',
    description: 'Disposals that reach their target',
  },
  scoreInvolvements: {
    id: 'scoreInvolvements',
    label: 'Score Involvements',
    shortLabel: 'SI',
    abbrev: 'SI',
    format: 'number',
    color: 'green',
    description: 'Involvement in team scoring chains',
  },
};

export const FANTASY_CATEGORY_KEYS = Object.freeze(
  Object.keys(FANTASY_CATEGORIES) as FantasyCategoryKey[]
);

const FANTASY_CATEGORY_KEY_SET = new Set<FantasyCategoryKey>(FANTASY_CATEGORY_KEYS);

export function isFantasyCategoryKey(value: unknown): value is FantasyCategoryKey {
  return typeof value === 'string' && FANTASY_CATEGORY_KEY_SET.has(value as FantasyCategoryKey);
}

const SUM_AGGREGATION: CategoryAggregation = { kind: 'sum' };

export function categoryAggregation(category: FantasyCategoryKey): CategoryAggregation {
  return FANTASY_CATEGORIES[category].aggregation ?? SUM_AGGREGATION;
}

/** The per-player stats a team's value for this category is computed from. */
export function categoryStatInputs(category: FantasyCategoryKey): ScoringStatKey[] {
  const aggregation = categoryAggregation(category);
  return aggregation.kind === 'ratio'
    ? [aggregation.numerator, aggregation.denominator]
    : [category];
}

/** Whether a league may score this category. */
export function isSelectableFantasyCategory(category: FantasyCategoryKey): boolean {
  return FANTASY_CATEGORIES[category].selectable !== false;
}

export function normalizeFantasyCategoryKeys(
  value: unknown,
  fallback: readonly FantasyCategoryKey[] = ['goals']
): FantasyCategoryKey[] {
  if (!Array.isArray(value)) return [...fallback];

  const categories = [...new Set(value.filter(isFantasyCategoryKey))];
  return categories.length > 0 ? categories : [...fallback];
}

// Statly value weights: one per league category in the nine-category preset, nothing else.
const STATLY_VALUE_WEIGHTS: Record<(typeof REAL_DATA_NINE_CATEGORY_PRESET)[number], number> = {
  goals: 6,
  tackles: 4,
  inside50s: 2,
  intercepts: 4,
  contestedMarks: 4,
  rebound50s: 3,
  contestedPossessions: 3,
  effectiveDisposals: 1,
  scoreInvolvements: 2,
};

/**
 * Statly value: the weighted per-game sum of the nine league categories, from recorded stats only
 * (no time-on-ground or disposal-efficiency adjustment, which the data does not reliably carry).
 */
export function calculateTotalValue(s: PlayerStats): number {
  const gp = Math.max(1, s.games); // avoid divide-by-zero
  let total = 0;
  for (const key of REAL_DATA_NINE_CATEGORY_PRESET) {
    total += (s[key] / gp) * STATLY_VALUE_WEIGHTS[key];
  }
  return Math.round(total);
}

/**
 * Format a stat value based on its category type
 */
export function formatStatValue(
  value: number | null | undefined,
  category: FantasyCategory
): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';

  switch (category.format) {
    case 'percentage':
      return `${value.toFixed(1)}%`;
    case 'decimal':
      return value.toFixed(2);
    case 'number':
    default:
      return value.toFixed(1);
  }
}

/**
 * A team or player category value on a scoreboard: "–" when unavailable (a team with no
 * disposals has no DE%), a percentage category to one decimal with "%", otherwise whole numbers
 * as they are and fractions to one decimal.
 */
export function formatCategoryValue(value: number | null | undefined, category: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '–';
  if (isFantasyCategoryKey(category) && FANTASY_CATEGORIES[category].format === 'percentage') {
    return `${value.toFixed(1)}%`;
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Get color class for a category
 */
export function getCategoryColorClass(color?: string): string {
  switch (color) {
    case 'red':
      return 'text-red-600';
    case 'green':
      return 'text-green-600';
    case 'blue':
      return 'text-blue-600';
    case 'orange':
      return 'text-orange-600';
    case 'purple':
      return 'text-purple-600';
    case 'yellow':
      return 'text-yellow-600';
    default:
      return 'text-gray-600';
  }
}

/**
 * Get stat value from PlayerStats object
 */
export function getStatValue(stats: PlayerStats | undefined, category: FantasyCategoryKey): number {
  if (!stats) return 0;
  return stats[category] || 0;
}

/**
 * Get color class based on stat value and category
 */
export function getStatColor(value: number | undefined, category: FantasyCategoryKey): string {
  const categoryData = FANTASY_CATEGORIES[category];
  return getCategoryColorClass(categoryData.color);
}
