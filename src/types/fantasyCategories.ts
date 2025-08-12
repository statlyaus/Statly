export type FantasyCategoryKey = 
  | 'goals' 
  | 'behinds' 
  | 'disposals' 
  | 'kicks' 
  | 'handballs' 
  | 'marks' 
  | 'tackles' 
  | 'hitouts' 
  | 'goalAccuracy' 
  | 'kickingEfficiency' 
  | 'disposalEfficiency' 
  | 'contestedPossessions' 
  | 'uncontestedPossessions' 
  | 'effectiveDisposals' 
  | 'clangers' 
  | 'turnovers' 
  | 'intercepts' 
  | 'onePercenters' 
  | 'bounces' 
  | 'metersGained' 
  | 'timeOnGroundPct' 
  | 'scoreInvolvements' 
  | 'inside50s';

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
  goals?: number;
  behinds?: number;
  disposals?: number;
  kicks?: number;
  handballs?: number;
  marks?: number;
  tackles?: number;
  hitouts?: number;
  goalAccuracy?: number;
  kickingEfficiency?: number;
  disposalEfficiency?: number;
  contestedPossessions?: number;
  uncontestedPossessions?: number;
  effectiveDisposals?: number;
  clangers?: number;
  turnovers?: number;
  intercepts?: number;
  onePercenters?: number;
  bounces?: number;
  metersGained?: number;
  timeOnGroundPct?: number;
  scoreInvolvements?: number;
  inside50s?: number;
  totalValue?: number;
  games?: number;
  seasonTotal?: number; // Legacy field
  // Legacy fields
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

export const FANTASY_CATEGORIES: Record<FantasyCategoryKey, FantasyCategory> = {
  goals: { 
    id: 'goals', 
    label: 'Goals', 
    shortLabel: 'G',
    abbrev: 'G',
    format: 'number', 
    color: 'green',
    description: 'Goals scored'
  },
  behinds: { 
    id: 'behinds', 
    label: 'Behinds', 
    shortLabel: 'B',
    abbrev: 'B',
    format: 'number', 
    color: 'orange',
    description: 'Behinds scored'
  },
  disposals: { 
    id: 'disposals', 
    label: 'Disposals', 
    shortLabel: 'D',
    abbrev: 'D',
    format: 'number', 
    color: 'blue',
    description: 'Total disposals (kicks + handballs)'
  },
  kicks: { 
    id: 'kicks', 
    label: 'Kicks', 
    shortLabel: 'K',
    abbrev: 'K',
    format: 'number', 
    color: 'blue',
    description: 'Kicks'
  },
  handballs: { 
    id: 'handballs', 
    label: 'Handballs', 
    shortLabel: 'HB',
    abbrev: 'HB',
    format: 'number', 
    color: 'blue',
    description: 'Handballs'
  },
  marks: { 
    id: 'marks', 
    label: 'Marks', 
    shortLabel: 'M',
    abbrev: 'M',
    format: 'number', 
    color: 'green',
    description: 'Marks taken'
  },
  tackles: { 
    id: 'tackles', 
    label: 'Tackles', 
    shortLabel: 'T',
    abbrev: 'T',
    format: 'number', 
    color: 'red',
    description: 'Tackles made'
  },
  hitouts: { 
    id: 'hitouts', 
    label: 'Hitouts', 
    shortLabel: 'HO',
    abbrev: 'HO',
    format: 'number', 
    color: 'purple',
    description: 'Ruck contests won'
  },
  goalAccuracy: { 
    id: 'goalAccuracy', 
    label: 'Goal Accuracy', 
    shortLabel: 'GA%',
    abbrev: 'GA%',
    format: 'percentage', 
    color: 'green',
    description: 'Percentage of shots that result in goals'
  },
  kickingEfficiency: { 
    id: 'kickingEfficiency', 
    label: 'Kicking Efficiency', 
    shortLabel: 'KE%',
    abbrev: 'KE%',
    format: 'percentage', 
    color: 'blue',
    description: 'Percentage of kicks that reach their target'
  },
  disposalEfficiency: { 
    id: 'disposalEfficiency', 
    label: 'Disposal Efficiency', 
    shortLabel: 'DE%',
    abbrev: 'DE%',
    format: 'percentage', 
    color: 'blue',
    description: 'Percentage of disposals that reach their target'
  },
  contestedPossessions: { 
    id: 'contestedPossessions', 
    label: 'Contested Possessions', 
    shortLabel: 'CP',
    abbrev: 'CP',
    format: 'number', 
    color: 'red',
    description: 'Possessions won in contested situations'
  },
  uncontestedPossessions: { 
    id: 'uncontestedPossessions', 
    label: 'Uncontested Possessions', 
    shortLabel: 'UP',
    abbrev: 'UP',
    format: 'number', 
    color: 'blue',
    description: 'Possessions won in uncontested situations'
  },
  effectiveDisposals: { 
    id: 'effectiveDisposals', 
    label: 'Effective Disposals', 
    shortLabel: 'ED',
    abbrev: 'ED',
    format: 'number', 
    color: 'green',
    description: 'Disposals that reach their target'
  },
  clangers: { 
    id: 'clangers', 
    label: 'Clangers', 
    shortLabel: 'CL',
    abbrev: 'CL',
    format: 'number', 
    color: 'red',
    description: 'Skill errors that directly benefit the opposition'
  },
  turnovers: { 
    id: 'turnovers', 
    label: 'Turnovers', 
    shortLabel: 'TO',
    abbrev: 'TO',
    format: 'number', 
    color: 'red',
    description: 'Possession losses'
  },
  intercepts: { 
    id: 'intercepts', 
    label: 'Intercepts', 
    shortLabel: 'I',
    abbrev: 'I',
    format: 'number', 
    color: 'green',
    description: 'Possessions gained from opposition'
  },
  onePercenters: { 
    id: 'onePercenters', 
    label: 'One Percenters', 
    shortLabel: '1%',
    abbrev: '1%',
    format: 'number', 
    color: 'purple',
    description: 'Defensive actions that prevent scoring'
  },
  bounces: { 
    id: 'bounces', 
    label: 'Bounces', 
    shortLabel: 'BO',
    abbrev: 'BO',
    format: 'number', 
    color: 'orange',
    description: 'Ball bounces'
  },
  metersGained: { 
    id: 'metersGained', 
    label: 'Meters Gained', 
    shortLabel: 'MG',
    abbrev: 'MG',
    format: 'number', 
    color: 'green',
    description: 'Meters gained through disposals'
  },
  timeOnGroundPct: { 
    id: 'timeOnGroundPct', 
    label: 'Time on Ground %', 
    shortLabel: 'TOG%',
    abbrev: 'TOG%',
    format: 'percentage', 
    color: 'yellow',
    description: 'Percentage of game time on ground'
  },
  scoreInvolvements: { 
    id: 'scoreInvolvements', 
    label: 'Score Involvements', 
    shortLabel: 'SI',
    abbrev: 'SI',
    format: 'number', 
    color: 'green',
    description: 'Involvement in team scoring chains'
  },
  inside50s: { 
    id: 'inside50s', 
    label: 'Inside 50s', 
    shortLabel: 'I50',
    abbrev: 'I50',
    format: 'number', 
    color: 'orange',
    description: 'Disposals into attacking 50m zone'
  }
};

// Base weights for all statistical categories (for reference)
export const BASE_WEIGHTS: Record<FantasyCategoryKey, number> = {
  goals: 6.0,
  behinds: 1.0,
  disposals: 1.0,
  kicks: 0.5,
  handballs: 0.5,
  marks: 2.5,
  tackles: 4.0,
  hitouts: 1.5,
  goalAccuracy: 0.0, // Percentage - not directly scored
  kickingEfficiency: 0.0, // Percentage - not directly scored
  disposalEfficiency: 0.0, // Percentage - not directly scored
  contestedPossessions: 3.0,
  uncontestedPossessions: 1.5,
  effectiveDisposals: 1.0,
  clangers: -3.0,
  turnovers: -2.0,
  intercepts: 3.0,
  onePercenters: 2.0,
  bounces: 0.5,
  metersGained: 0.01, // Per meter
  timeOnGroundPct: 0.0, // Percentage - not directly scored
  scoreInvolvements: 4.0,
  inside50s: 2.0
};

/**
 * Calculate total value across specific league categories - guidance tool only
 * This shows users the combined value of a player across their selected categories
 */
export function calculateLeagueValue(
  stats: Record<string, number>, 
  selectedCategories: FantasyCategoryKey[], 
  games: number = 1
): number {
  if (games === 0 || selectedCategories.length === 0) return 0;

  // Calculate per-game averages for the player
  const perGameStats = Object.entries(stats).reduce((acc, [key, value]) => {
    acc[key] = value / games;
    return acc;
  }, {} as Record<string, number>);

  let totalValue = 0;

  // Sum up values only for the categories selected in this league
  selectedCategories.forEach(category => {
    const statValue = perGameStats[category] || 0;
    const categoryData = FANTASY_CATEGORIES[category];
    
    // For guidance purposes, use normalized values
    if (categoryData.format === 'percentage') {
      // For percentages, use the percentage value directly (e.g., 75% = 75 points)
      totalValue += statValue;
    } else {
      // For counting stats, use per-game values
      totalValue += statValue;
    }
  });

  return Math.round(totalValue * 100) / 100; // Round to 2 decimal places
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
    case 'red': return 'text-red-600';
    case 'green': return 'text-green-600';
    case 'blue': return 'text-blue-600';
    case 'orange': return 'text-orange-600';
    case 'purple': return 'text-purple-600';
    case 'yellow': return 'text-yellow-600';
    default: return 'text-gray-600';
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
