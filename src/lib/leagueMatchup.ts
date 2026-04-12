import { RAW_KEY_MAP } from '@/lib/stats/statColumns';
import { FANTASY_CATEGORIES, type FantasyCategoryKey } from '@/types/fantasyCategories';

function isFantasyCategoryKey(key: string): key is FantasyCategoryKey {
  return Object.prototype.hasOwnProperty.call(FANTASY_CATEGORIES, key);
}

/**
 * Normalise a Firestore `player_match_stats` document into the stat bag used for
 * head-to-head scoring. Footywire and ETL often place fields on the document root
 * or under `raw_row` while nested `stats` is partial — reading only `stats`
 * dropped metres gained and other snake_case aliases.
 */
function coerceFiniteStatNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const n = Number(trimmed.replace(/,/g, ''));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function mergeFirestorePlayerMatchStats(
  data: Record<string, unknown>
): Record<string, number | undefined> {
  const nested = (data.stats as Record<string, unknown> | undefined) ?? {};
  const raw = (data.raw_row as Record<string, unknown> | undefined) ?? {};
  const merged: Record<string, number | undefined> = {};
  const rawMap = RAW_KEY_MAP as Record<string, string>;

  const ingest = (rec: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(rec)) {
      const num = coerceFiniteStatNumber(value);
      if (num === undefined) continue;
      const mapped = rawMap[key] ?? rawMap[key.toLowerCase()];
      const canonical = mapped ?? (isFantasyCategoryKey(key) ? key : undefined);
      if (!canonical || !isFantasyCategoryKey(canonical)) continue;
      if (merged[canonical] === undefined) merged[canonical] = num;
    }
  };

  ingest(nested);
  ingest(data);
  ingest(raw);
  return merged;
}

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

export function pickActiveLineup(
  playerIds: string[],
  activePlayerLimit = LINEUP_SIZES.starters + LINEUP_SIZES.interchange
): string[] {
  return playerIds.slice(0, activePlayerLimit);
}

function getCategoryValue(
  playerStat: MatchupPlayerStat | undefined,
  category: FantasyCategoryKey
): number {
  if (!playerStat) return 0;
  const directKey = CATEGORY_STAT_PATHS[category];
  const aliases = [directKey, directKey.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`)];
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
  return playerIds.reduce(
    (sum, playerId) => sum + getCategoryValue(statsByPlayerId.get(playerId), category),
    0
  );
}

export function buildHeadToHeadCategoryScores(input: {
  categories: FantasyCategoryKey[];
  homePlayerIds: string[];
  awayPlayerIds: string[];
  statsByPlayerId: Map<string, MatchupPlayerStat>;
  activePlayerLimit?: number;
}) {
  const activePlayerLimit =
    input.activePlayerLimit ?? LINEUP_SIZES.starters + LINEUP_SIZES.interchange;
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
