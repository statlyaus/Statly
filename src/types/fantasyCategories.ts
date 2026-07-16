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

export interface FantasyCategory {
  id: FantasyCategoryKey;
  label: string;
  shortLabel?: string;
  abbrev?: string; // For backward compatibility
  format: 'number' | 'percentage' | 'decimal';
  color?: 'red' | 'green' | 'blue' | 'orange' | 'purple' | 'yellow';
  description?: string;
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
    shortLabel: 'CL',
    abbrev: 'CL',
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
  },
  disposalEffPct: {
    id: 'disposalEffPct',
    label: 'Disposal Efficiency %',
    shortLabel: 'DE%',
    abbrev: 'DE%',
    format: 'percentage',
    color: 'blue',
    description: 'Percentage of disposals that reach their target',
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
    shortLabel: 'I',
    abbrev: 'I',
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

const FANTASY_CATEGORY_KEYS = new Set<FantasyCategoryKey>(
  Object.keys(FANTASY_CATEGORIES) as FantasyCategoryKey[]
);

export function isFantasyCategoryKey(value: unknown): value is FantasyCategoryKey {
  return typeof value === 'string' && FANTASY_CATEGORY_KEYS.has(value as FantasyCategoryKey);
}

export function normalizeFantasyCategoryKeys(
  value: unknown,
  fallback: readonly FantasyCategoryKey[] = ['goals']
): FantasyCategoryKey[] {
  if (!Array.isArray(value)) return [...fallback];

  const categories = [...new Set(value.filter(isFantasyCategoryKey))];
  return categories.length > 0 ? categories : [...fallback];
}

// Weights for all statistical categories (excluding games, timeOnGroundPct, disposalEffPct)
const WEIGHTS: Record<
  keyof Omit<
    PlayerStats,
    | 'games'
    | 'timeOnGroundPct'
    | 'disposalEffPct'
    | 'seasonTotal'
    | 'avgFantasyPoints'
    | 'lastGameFantasyPoints'
  >,
  number
> = {
  kicks: 0.5,
  handballs: 0.5,
  marks: 2.5,
  tackles: 4,
  goals: 6,
  hitouts: 1.5,
  clearances: 4,
  inside50s: 2,
  rebound50s: 3,
  clangers: -3,
  contestedPossessions: 3,
  uncontestedPossessions: 0.5,
  freesFor: 1,
  freesAgainst: -1,
  onePercenters: 3,
  goalAssists: 3,
  turnovers: -2,
  intercepts: 4,
  metresGained: 0.05, // ~1 per 20m
  contestedMarks: 4,
  effectiveDisposals: 1,
  scoreInvolvements: 2,
};

/**
 * Calculate total value using your weighted scoring system with efficiency modulation
 */
export function calculateTotalValue(s: PlayerStats): number {
  const gp = Math.max(1, s.games); // avoid divide-by-zero

  // Per‑game rates
  const perGame = {
    kicks: s.kicks / gp,
    handballs: s.handballs / gp,
    marks: s.marks / gp,
    tackles: s.tackles / gp,
    goals: s.goals / gp,
    hitouts: s.hitouts / gp,
    clearances: s.clearances / gp,
    inside50s: s.inside50s / gp,
    rebound50s: s.rebound50s / gp,
    clangers: s.clangers / gp,
    contestedPossessions: s.contestedPossessions / gp,
    uncontestedPossessions: s.uncontestedPossessions / gp,
    freesFor: s.freesFor / gp,
    freesAgainst: s.freesAgainst / gp,
    onePercenters: s.onePercenters / gp,
    goalAssists: s.goalAssists / gp,
    turnovers: s.turnovers / gp,
    intercepts: s.intercepts / gp,
    metresGained: s.metresGained / gp,
    contestedMarks: s.contestedMarks / gp,
    effectiveDisposals: s.effectiveDisposals / gp,
    scoreInvolvements: s.scoreInvolvements / gp,
  };

  // Weighted base score
  let base =
    perGame.kicks * WEIGHTS.kicks +
    perGame.handballs * WEIGHTS.handballs +
    perGame.marks * WEIGHTS.marks +
    perGame.tackles * WEIGHTS.tackles +
    perGame.goals * WEIGHTS.goals +
    perGame.hitouts * WEIGHTS.hitouts +
    perGame.clearances * WEIGHTS.clearances +
    perGame.inside50s * WEIGHTS.inside50s +
    perGame.rebound50s * WEIGHTS.rebound50s +
    perGame.clangers * WEIGHTS.clangers +
    perGame.contestedPossessions * WEIGHTS.contestedPossessions +
    perGame.uncontestedPossessions * WEIGHTS.uncontestedPossessions +
    perGame.freesFor * WEIGHTS.freesFor +
    perGame.freesAgainst * WEIGHTS.freesAgainst +
    perGame.onePercenters * WEIGHTS.onePercenters +
    perGame.goalAssists * WEIGHTS.goalAssists +
    perGame.turnovers * WEIGHTS.turnovers +
    perGame.intercepts * WEIGHTS.intercepts +
    perGame.metresGained * WEIGHTS.metresGained +
    perGame.contestedMarks * WEIGHTS.contestedMarks +
    perGame.effectiveDisposals * WEIGHTS.effectiveDisposals +
    perGame.scoreInvolvements * WEIGHTS.scoreInvolvements;

  // Efficiency modulation factors (your exact specification)
  const togFactor = Math.min(1.5, Math.max(0.7, (s.timeOnGroundPct - 60) / 40 + 1));
  const deFactor = Math.min(1.3, Math.max(0.8, (s.disposalEffPct - 70) / 30 + 1));

  const totalValue = base * togFactor * deFactor;

  return Math.round(totalValue);
}

/**
 * Format a stat value based on its category type
 */
export function formatStatValue(value: number, category: FantasyCategory): string {
  switch (category.format) {
    case 'percentage':
      return `${value.toFixed(1)}%`;
    case 'decimal':
      return value.toFixed(2);
    case 'number':
    default:
      return Math.round(value).toString();
  }
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
