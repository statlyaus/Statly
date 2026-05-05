import type { CanonicalStatKey } from '@/lib/stats/statColumns';

export const PLAYER_RANKING_METHOD = 'zscore_replacement';
export const PLAYER_RANKING_METHOD_VERSION = 1;
export const PLAYER_RANKING_MIN_GAMES = 2;

const SMALL_SAMPLE_MAX_GAMES = 3;
const DEFAULT_PUBLIC_LEAGUE_SIZE = 10;

const POSITION_REPLACEMENT_SLOTS = {
  DEF: 6,
  MID: 8,
  FWD: 6,
  RUC: 2,
} as const satisfies Record<string, number>;

const RANKING_CATEGORY_KEYS = [
  'kicks',
  'handballs',
  'marks',
  'tackles',
  'goals',
  'hitouts',
  'clearances',
  'inside50s',
  'rebound50s',
  'clangers',
  'contestedPossessions',
  'uncontestedPossessions',
  'freesFor',
  'freesAgainst',
  'onePercenters',
  'goalAssists',
  'turnovers',
  'intercepts',
  'metresGained',
  'contestedMarks',
  'effectiveDisposals',
  'scoreInvolvements',
] as const satisfies readonly CanonicalStatKey[];

const NEGATIVE_CATEGORY_KEYS = new Set<CanonicalStatKey>(['clangers', 'freesAgainst', 'turnovers']);

export type RankingCategoryKey = (typeof RANKING_CATEGORY_KEYS)[number];
export type RankingPositionKey = keyof typeof POSITION_REPLACEMENT_SLOTS;

export type RankingSummaryInput = {
  playerId: string;
  playerName: string;
  club: string;
  position: string;
  gamesPlayed: number;
  averageScore: number;
  totalValue: number;
  stats: Record<CanonicalStatKey, number>;
  totals: Record<CanonicalStatKey, number>;
};

export type PlayerRankingEngineRow = {
  playerId: string;
  playerName: string;
  club: string;
  position: string;
  gamesPlayed: number;
  averageScore: number;
  totalValue: number;
  rankingValue: number;
  categories: Record<string, number>;
  stats: Record<CanonicalStatKey, number>;
  totals: Record<CanonicalStatKey, number>;
  minimumGames: number;
  populationSize: number;
  isSmallSample: boolean;
  metadata: {
    eligiblePositions: RankingPositionKey[];
    replacementPosition: RankingPositionKey | null;
    replacementBaseline: number;
    rawCategoryTotal: number;
    publicLeagueSize: number;
  };
};

type EligibleRankingPlayer = {
  summary: RankingSummaryInput;
  eligiblePositions: RankingPositionKey[];
  categoryValues: Record<RankingCategoryKey, number>;
  categoryZScores: Record<RankingCategoryKey, number>;
  rawCategoryTotal: number;
};

function normalizePositionToken(token: string): RankingPositionKey | null {
  const normalized = token.trim().toUpperCase();
  if (normalized === 'RUCK') return 'RUC';
  if (
    normalized === 'RUC' ||
    normalized === 'DEF' ||
    normalized === 'MID' ||
    normalized === 'FWD'
  ) {
    return normalized;
  }
  return null;
}

export function parseRankingPositions(position: string): RankingPositionKey[] {
  const tokens = position
    .split(/[/,\s]+/)
    .map((token) => normalizePositionToken(token))
    .filter((token): token is RankingPositionKey => token !== null);

  const normalizedTokens: RankingPositionKey[] = tokens.length > 0 ? tokens : ['MID'];
  return Array.from(new Set(normalizedTokens));
}

function toCategoryValues(summary: RankingSummaryInput): Record<RankingCategoryKey, number> {
  const values = {} as Record<RankingCategoryKey, number>;

  for (const key of RANKING_CATEGORY_KEYS) {
    const perGameValue = summary.stats[key] ?? 0;
    values[key] = NEGATIVE_CATEGORY_KEYS.has(key) ? -perGameValue : perGameValue;
  }

  return values;
}

function calculateCategoryStats(players: EligibleRankingPlayer[]) {
  const means = {} as Record<RankingCategoryKey, number>;
  const standardDeviations = {} as Record<RankingCategoryKey, number>;

  for (const key of RANKING_CATEGORY_KEYS) {
    const values = players.map((player) => player.categoryValues[key]);
    const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    const variance =
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length);
    means[key] = mean;
    standardDeviations[key] = Math.sqrt(variance) || 1;
  }

  return { means, standardDeviations };
}

function calculateReplacementBaselines(players: EligibleRankingPlayer[]) {
  const baselines = {} as Record<RankingPositionKey, number>;

  for (const position of Object.keys(POSITION_REPLACEMENT_SLOTS) as RankingPositionKey[]) {
    const slotCount = POSITION_REPLACEMENT_SLOTS[position] * DEFAULT_PUBLIC_LEAGUE_SIZE;
    const eligible = players
      .filter((player) => player.eligiblePositions.includes(position))
      .sort((left, right) => right.rawCategoryTotal - left.rawCategoryTotal);

    if (eligible.length === 0) {
      baselines[position] = 0;
      continue;
    }

    const replacementIndex = Math.max(0, Math.min(slotCount, eligible.length) - 1);
    baselines[position] = eligible[replacementIndex]?.rawCategoryTotal ?? 0;
  }

  return baselines;
}

export function buildPlayerRankingRows(summaries: RankingSummaryInput[]): PlayerRankingEngineRow[] {
  const eligiblePlayers: EligibleRankingPlayer[] = summaries
    .filter((summary) => summary.gamesPlayed >= PLAYER_RANKING_MIN_GAMES)
    .map((summary) => ({
      summary,
      eligiblePositions: parseRankingPositions(summary.position),
      categoryValues: toCategoryValues(summary),
      categoryZScores: {} as Record<RankingCategoryKey, number>,
      rawCategoryTotal: 0,
    }));

  if (eligiblePlayers.length === 0) {
    return [];
  }

  const { means, standardDeviations } = calculateCategoryStats(eligiblePlayers);
  for (const player of eligiblePlayers) {
    let rawCategoryTotal = 0;
    for (const key of RANKING_CATEGORY_KEYS) {
      const zScore = (player.categoryValues[key] - means[key]) / standardDeviations[key];
      player.categoryZScores[key] = Number(zScore.toFixed(6));
      rawCategoryTotal += zScore;
    }
    player.rawCategoryTotal = rawCategoryTotal;
  }

  const replacementBaselines = calculateReplacementBaselines(eligiblePlayers);

  return eligiblePlayers
    .map((player) => {
      let replacementPosition: RankingPositionKey | null = null;
      let replacementBaseline = Number.NEGATIVE_INFINITY;
      let rankingValue = Number.NEGATIVE_INFINITY;

      for (const position of player.eligiblePositions) {
        const baseline = replacementBaselines[position] ?? 0;
        const valueOverReplacement = player.rawCategoryTotal - baseline;
        if (valueOverReplacement > rankingValue) {
          rankingValue = valueOverReplacement;
          replacementBaseline = baseline;
          replacementPosition = position;
        }
      }

      return {
        playerId: player.summary.playerId,
        playerName: player.summary.playerName,
        club: player.summary.club,
        position: player.summary.position,
        gamesPlayed: player.summary.gamesPlayed,
        averageScore: player.summary.averageScore,
        totalValue: player.summary.totalValue,
        rankingValue: Number(rankingValue.toFixed(6)),
        categories: Object.fromEntries(
          RANKING_CATEGORY_KEYS.map((key) => [key, player.categoryZScores[key]])
        ),
        stats: player.summary.stats,
        totals: player.summary.totals,
        minimumGames: PLAYER_RANKING_MIN_GAMES,
        populationSize: eligiblePlayers.length,
        isSmallSample: player.summary.gamesPlayed <= SMALL_SAMPLE_MAX_GAMES,
        metadata: {
          eligiblePositions: player.eligiblePositions,
          replacementPosition,
          replacementBaseline: Number(replacementBaseline.toFixed(6)),
          rawCategoryTotal: Number(player.rawCategoryTotal.toFixed(6)),
          publicLeagueSize: DEFAULT_PUBLIC_LEAGUE_SIZE,
        },
      } satisfies PlayerRankingEngineRow;
    })
    .sort((left, right) => {
      if (right.rankingValue !== left.rankingValue) {
        return right.rankingValue - left.rankingValue;
      }
      return left.playerName.localeCompare(right.playerName);
    });
}
