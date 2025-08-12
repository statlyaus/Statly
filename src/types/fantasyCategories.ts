// Fantasy AFL scoring categories available for leagues
export const FANTASY_CATEGORIES = {
  kicks: { label: 'Kicks', abbrev: 'K', description: 'Total kicks' },
  handballs: { label: 'Handballs', abbrev: 'HB', description: 'Total handballs' },
  marks: { label: 'Marks', abbrev: 'M', description: 'Total marks' },
  tackles: { label: 'Tackles', abbrev: 'T', description: 'Total tackles' },
  goals: { label: 'Goals', abbrev: 'G', description: 'Goals scored' },
  hitouts: { label: 'Hitouts', abbrev: 'HO', description: 'Ruck contests won' },
  clearances: { label: 'Clearances', abbrev: 'CL', description: 'Clearances won' },
  inside50s: { label: 'Inside 50s', abbrev: 'I50', description: 'Inside 50 entries' },
  rebound50s: { label: 'Rebound 50s', abbrev: 'R50', description: 'Rebound 50s' },
  clangers: { label: 'Clangers', abbrev: 'CG', description: 'Turnovers/errors' },
  contestedPossessions: { label: 'Contested Possessions', abbrev: 'CP', description: 'Contested possessions' },
  uncontestedPossessions: { label: 'Uncontested Possessions', abbrev: 'UP', description: 'Uncontested possessions' },
  freesFor: { label: 'Frees For', abbrev: 'FF', description: 'Free kicks received' },
  freesAgainst: { label: 'Frees Against', abbrev: 'FA', description: 'Free kicks conceded' },
  onePercenters: { label: 'One Percenters', abbrev: '1%', description: 'One percenters' },
  goalAssists: { label: 'Goal Assists', abbrev: 'GA', description: 'Goal assists' },
  timeOnGround: { label: 'Time on Ground %', abbrev: 'TOG%', description: 'Time on ground percentage' },
  disposalEfficiency: { label: 'Disposal Efficiency %', abbrev: 'DE%', description: 'Disposal efficiency percentage' },
  turnovers: { label: 'Turnovers', abbrev: 'TO', description: 'Turnovers conceded' },
  intercepts: { label: 'Intercepts', abbrev: 'INT', description: 'Intercepts made' },
  metresGained: { label: 'Metres Gained', abbrev: 'MG', description: 'Metres gained' },
  contestedMarks: { label: 'Contested Marks', abbrev: 'CM', description: 'Contested marks taken' },
  effectiveDisposals: { label: 'Effective Disposals', abbrev: 'ED', description: 'Effective disposals' },
  scoreInvolvements: { label: 'Score Involvements', abbrev: 'SI', description: 'Score involvements' },
  
  // Computed stats
  avgFantasyPoints: { label: 'Avg Fantasy Points', abbrev: 'AFP', description: 'Average fantasy points per game' },
  lastGameFantasyPoints: { label: 'Last Game Points', abbrev: 'LGP', description: 'Fantasy points from last game' }
} as const;

export type FantasyCategoryKey = keyof typeof FANTASY_CATEGORIES;

export interface PlayerStats {
  // Basic stats
  kicks?: number;
  handballs?: number;
  marks?: number;
  tackles?: number;
  goals?: number;
  hitouts?: number;
  clearances?: number;
  inside50s?: number;
  rebound50s?: number;
  clangers?: number;
  contestedPossessions?: number;
  uncontestedPossessions?: number;
  freesFor?: number;
  freesAgainst?: number;
  onePercenters?: number;
  goalAssists?: number;
  
  // Percentage stats
  timeOnGround?: number;
  disposalEfficiency?: number;
  
  // Advanced stats
  turnovers?: number;
  intercepts?: number;
  metresGained?: number;
  contestedMarks?: number;
  effectiveDisposals?: number;
  scoreInvolvements?: number;
  
  // Computed stats
  avgFantasyPoints?: number;
  lastGameFantasyPoints?: number;
  seasonTotal?: number;
}

export interface LeagueSettings {
  id: string;
  name: string;
  selectedCategories: FantasyCategoryKey[];
  categoryWeights?: Record<FantasyCategoryKey, number>;
  maxCategories: number; // Usually 8 or 9
  scoringType: 'total' | 'average' | 'custom';
}

export interface ExtendedDraftPlayer {
  id: string;
  name: string;
  position: string;
  club: string;
  stats?: PlayerStats;
  injuryStatus?: 'healthy' | 'questionable' | 'injured' | 'out';
  byeWeek?: number;
}

// Utility functions for category management
export const getSelectedCategoryData = (
  selectedCategories: FantasyCategoryKey[]
): Array<{key: FantasyCategoryKey, label: string, abbrev: string, description: string}> => {
  return selectedCategories.map(key => ({
    key,
    ...FANTASY_CATEGORIES[key]
  }));
};

export const calculateFantasyScore = (
  stats: PlayerStats,
  categories: FantasyCategoryKey[],
  weights?: Record<FantasyCategoryKey, number>
): number => {
  let total = 0;
  
  categories.forEach(category => {
    const value = stats[category];
    if (typeof value === 'number') {
      const weight = weights?.[category] || 1;
      total += value * weight;
    }
  });
  
  return total;
};

export const getStatValue = (stats: PlayerStats | undefined, category: FantasyCategoryKey): number | string => {
  if (!stats) return '-';
  
  const value = stats[category];
  if (value === undefined || value === null) return '-';
  
  // Handle percentage categories
  if (category === 'timeOnGround' || category === 'disposalEfficiency') {
    return `${value.toFixed(1)}%`;
  }
  
  // Handle decimal categories
  if (category === 'avgFantasyPoints' || category === 'lastGameFantasyPoints') {
    return value.toFixed(1);
  }
  
  // Handle whole number categories
  return Math.round(value).toString();
};

export const getStatColor = (value: number | undefined, category: FantasyCategoryKey): string => {
  if (!value) return 'text-gray-400';
  
  // Define thresholds for different categories (these would be configurable)
  const thresholds = {
    kicks: { good: 20, excellent: 30 },
    handballs: { good: 15, excellent: 25 },
    marks: { good: 8, excellent: 12 },
    tackles: { good: 6, excellent: 10 },
    goals: { good: 2, excellent: 4 },
    hitouts: { good: 15, excellent: 30 },
    clearances: { good: 4, excellent: 8 },
    inside50s: { good: 4, excellent: 7 },
    rebound50s: { good: 3, excellent: 6 },
    contestedPossessions: { good: 12, excellent: 18 },
    disposalEfficiency: { good: 75, excellent: 85 },
    avgFantasyPoints: { good: 80, excellent: 100 }
  };
  
  const threshold = thresholds[category as keyof typeof thresholds];
  if (!threshold) return 'text-gray-700';
  
  if (value >= threshold.excellent) return 'text-green-600 font-semibold';
  if (value >= threshold.good) return 'text-blue-600';
  return 'text-gray-700';
};
