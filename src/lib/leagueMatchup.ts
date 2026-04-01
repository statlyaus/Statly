import { FANTASY_CATEGORIES, type FantasyCategoryKey } from '@/types/fantasyCategories';

export const LINEUP_SIZES = {
  starters: 18,
  interchange: 4,
  emergency: 2,
} as const;

export const CATEGORY_STAT_PATHS: Record<FantasyCategoryKey, string> = {
  goals: 'goals',
  kicks: 'kicks',
  handballs: 'handballs',
  marks: 'marks',
  tackles: 'tackles',
  hitouts: 'hitouts',
  clearances: 'clearances',
  inside50s: 'inside50s',
  rebound50s: 'rebound50s',
  clangers: 'clangers',
  contestedPossessions: 'contestedPossessions',
  uncontestedPossessions: 'uncontestedPossessions',
  freesFor: 'freesFor',
  freesAgainst: 'freesAgainst',
  onePercenters: 'onePercenters',
  goalAssists: 'goalAssists',
  timeOnGroundPct: 'timeOnGroundPct',
  disposalEffPct: 'disposalEffPct',
  turnovers: 'turnovers',
  intercepts: 'intercepts',
  metresGained: 'metresGained',
  contestedMarks: 'contestedMarks',
  effectiveDisposals: 'effectiveDisposals',
  scoreInvolvements: 'scoreInvolvements',
};

export type MatchupPlayerStat = {
  playerId: string;
  playerName: string;
  team?: string;
  position?: string;
  stats: Record<string, number | undefined>;
};

export type MatchupCategoryResult = {
  key: FantasyCategoryKey;
  label: string;
  home: number;
  away: number;
  winner: 'home' | 'away' | 'tie';
};

export function pickActiveLineup(playerIds: string[], activePlayerLimit = LINEUP_SIZES.starters + LINEUP_SIZES.interchange): string[] {
  return playerIds.slice(0, activePlayerLimit);
}

function getCategoryValue(
  playerStat: MatchupPlayerStat | undefined,
  category: FantasyCategoryKey
): number {
  if (!playerStat) return 0;
  const directKey = CATEGORY_STAT_PATHS[category];
  const aliases = [
    directKey,
    directKey.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`),
  ];
  for (const key of aliases) {
    const value = playerStat.stats[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

function sumCategoryForTeam(
  playerIds: string[],
  category: FantasyCategoryKey,
  statsByPlayerId: Map<string, MatchupPlayerStat>
): number {
  return playerIds.reduce((sum, playerId) => sum + getCategoryValue(statsByPlayerId.get(playerId), category), 0);
}

export function buildHeadToHeadCategoryScores(input: {
  categories: FantasyCategoryKey[];
  homePlayerIds: string[];
  awayPlayerIds: string[];
  statsByPlayerId: Map<string, MatchupPlayerStat>;
  activePlayerLimit?: number;
}) {
  const activePlayerLimit = input.activePlayerLimit ?? LINEUP_SIZES.starters + LINEUP_SIZES.interchange;
  const homeActive = pickActiveLineup(input.homePlayerIds, activePlayerLimit);
  const awayActive = pickActiveLineup(input.awayPlayerIds, activePlayerLimit);

  const categories: MatchupCategoryResult[] = input.categories.map((category) => {
    const home = sumCategoryForTeam(homeActive, category, input.statsByPlayerId);
    const away = sumCategoryForTeam(awayActive, category, input.statsByPlayerId);
    const winner = home === away ? 'tie' : home > away ? 'home' : 'away';

    return {
      key: category,
      label: FANTASY_CATEGORIES[category]?.label ?? category,
      home,
      away,
      winner,
    };
  });

  const homeSummary = { wins: 0, losses: 0, ties: 0 };
  const awaySummary = { wins: 0, losses: 0, ties: 0 };

  for (const category of categories) {
    if (category.winner === 'home') {
      homeSummary.wins += 1;
      awaySummary.losses += 1;
    } else if (category.winner === 'away') {
      homeSummary.losses += 1;
      awaySummary.wins += 1;
    } else {
      homeSummary.ties += 1;
      awaySummary.ties += 1;
    }
  }

  return {
    categories,
    home: {
      activePlayerIds: homeActive,
      summary: homeSummary,
    },
    away: {
      activePlayerIds: awayActive,
      summary: awaySummary,
    },
  };
}
