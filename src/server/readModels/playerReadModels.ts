import type { Prisma, PrismaClient } from '@prisma/client';

import { getDefaultAflSeason } from '@/lib/aflSeason';
import { adminDb } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import {
  buildMatchLogEntityKey,
  buildMatchLogStageSnapshot,
  dedupeByDateOpponent,
  MATCH_LOG_NULLABLE_STAT_KEYS,
  type MatchLogRow,
  type MatchLogStageSnapshot,
  type MatchLogStatAvailability,
  type MatchLogStats,
} from '@/lib/matchLogs';
import {
  createPlayerIdentityResolver,
  readCanonicalMatchKey,
  readCanonicalPlayerId,
  resolveCanonicalPlayerIdFromRecord,
} from '@/lib/playerMatchStats';
import { prisma } from '@/lib/prisma';
import { buildCanonicalPlayerId } from '@/lib/playerIdentity';
import {
  hasFootywireCanonicalRawMatchContract,
  readFootywireCanonicalStatNumber,
  readFootywireCanonicalStatPresence,
  readFootywireCanonicalStatProvenance,
} from '@/lib/stats/footywireCanonicalContract';
import {
  CANONICAL_STAT_KEYS,
  canonicalStatKeyFromRaw,
  type CanonicalStatKey,
} from '@/lib/stats/statColumns';
import { normalizeTeamName as normalizeAflTeamName } from '@shared/player-identity/teamNames';
import {
  buildPlayerRankingRows,
  PLAYER_RANKING_METHOD,
  PLAYER_RANKING_METHOD_VERSION,
  PLAYER_RANKING_MIN_GAMES,
} from '@/server/rankings/playerRankingEngine';
import { calculateTotalValue, type PlayerStats } from '@/types/fantasyCategories';

type FirestoreLike = typeof adminDb;
type PrismaDb = PrismaClient;
type PrismaReadWriteClient = PrismaClient | Prisma.TransactionClient;

export type PlayerSeasonSummaryRow = {
  id: string;
  playerId: string;
  season: number;
  playerName: string;
  club: string;
  position: string;
  gamesPlayed: number;
  averageScore: number;
  totalValue: number;
  stats: Record<CanonicalStatKey, number>;
  totals: Record<CanonicalStatKey, number>;
  sourceUpdatedAt: Date;
};

export const SCORING_CRITICAL_ADVANCED_STATS: CanonicalStatKey[] = [
  'clearances',
  'inside50s',
  'rebound50s',
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
  'timeOnGroundPct',
  'disposalEffPct',
  'minutes',
];

export type AdvancedStatIntegrity = {
  sourceRowsWithValue: Record<CanonicalStatKey, number>;
  sourceRowsWithNonZeroValue: Record<CanonicalStatKey, number>;
  summaryPlayersWithNonZeroValue: Record<CanonicalStatKey, number>;
  degradedStats: CanonicalStatKey[];
};

export type PlayerRankingSnapshotRow = {
  id: string;
  season: number;
  scope: string;
  method: string;
  methodVersion: number;
  rank: number;
  playerId: string;
  playerName: string;
  club: string;
  position: string;
  gamesPlayed: number;
  averageScore: number;
  totalValue: number;
  rankingValue: number;
  minimumGames: number;
  populationSize: number;
  isSmallSample: boolean;
  categories: Record<string, number>;
  stats: Record<CanonicalStatKey, number>;
  totals: Record<CanonicalStatKey, number>;
  metadata: Record<string, unknown> | null;
  snapshotAt: Date;
};

export type PlayerRecentFormSummaryRow = {
  id: string;
  playerId: string;
  season: number;
  window: string;
  gamesIncluded: number;
  averageScore: number;
  totalValue: number;
  stats: Record<CanonicalStatKey, number>;
  totals: Record<CanonicalStatKey, number>;
  sourceUpdatedAt: Date;
};

export type PlayerLatestSnapshotRow = {
  id: string;
  playerId: string;
  season: number;
  matchUid: string | null;
  round: number | null;
  statSource: string;
  isLive: boolean;
  lastSeenAt: Date | null;
  averageScore: number;
  totalValue: number;
  stats: Record<CanonicalStatKey, number>;
  totals: Record<CanonicalStatKey, number>;
  sourceUpdatedAt: Date;
};

export type PlayerMatchLogProjectionRow = {
  id: string;
  playerId: string;
  season: number;
  roundNumber: number;
  matchId: string;
  matchDate: string;
  opponent: string;
  stats: MatchLogStats;
  statAvailability?: MatchLogStatAvailability;
  sourceUpdatedAt: Date;
};

export type MatchLogReconciliationStageRow = {
  entityKey: string;
  matchId: string;
  storageMatchId?: string | null;
  season: number;
  roundNumber: number;
  playerId: string | null;
  storagePlayerId?: string | null;
  playerName: string;
  opponent: string;
  stage: MatchLogStageSnapshot;
  sourceUpdatedAt: Date | null;
};

export type SeasonSummaryReconciliationRow = {
  playerId: string;
  playerName: string;
  season: number;
  gamesPlayed: number;
  stats: Record<CanonicalStatKey, number>;
  totals: Record<CanonicalStatKey, number>;
  sourceUpdatedAt: Date;
};

export type LeagueRosterPlayerSummaryRow = {
  id: string;
  leagueId: string;
  memberId: string;
  playerId: string;
  season: number;
  sortOrder: number;
  playerName: string;
  club: string;
  position: string;
  ownership: number;
  isCaptain: boolean;
  isViceCaptain: boolean;
  gamesPlayed: number;
  averageScore: number;
  totalValue: number;
  price: number;
  lastGameScore: number;
  projectedScore: number;
  form: number[];
  stats: Record<CanonicalStatKey, number>;
  totals: Record<CanonicalStatKey, number>;
};

type AggregatedPlayer = {
  playerId: string;
  playerName: string;
  club: string;
  position: string;
  totals: Record<CanonicalStatKey, number>;
  gamesPlayed: number;
  lastUpdatedAt: Date;
  seenMatchKeys: Set<string>;
};

type PlayerMatchProjection = {
  matchKey: string;
  matchUid: string | null;
  season: number;
  round: number | null;
  matchDate: string;
  opponent: string;
  totals: Record<CanonicalStatKey, number>;
  statAvailability: MatchLogStatAvailability;
  updatedAt: Date;
  lastSeenAt: Date | null;
  isLive: boolean;
};

type SelectedCanonicalRawRow = {
  data: Record<string, unknown>;
  playerId: string;
  storagePlayerId: string | null;
  playerProfile: { id: string; name: string; club: string; position: string | null; active: boolean | null };
  playerName: string;
  matchId: string;
  storageMatchId: string | null;
  season: number;
  roundNumber: number | null;
  opponent: string;
  matchDate: string;
  updatedAt: Date;
};

function buildEmptyStats(): Record<CanonicalStatKey, number> {
  const empty = {} as Record<CanonicalStatKey, number>;
  for (const key of CANONICAL_STAT_KEYS) {
    empty[key] = 0;
  }
  return empty;
}

function buildEmptyCoverageRecord(): Record<CanonicalStatKey, number> {
  const empty = {} as Record<CanonicalStatKey, number>;
  for (const key of CANONICAL_STAT_KEYS) {
    empty[key] = 0;
  }
  return empty;
}

function buildMatchLogStatAvailability(): MatchLogStatAvailability {
  const availability = {} as MatchLogStatAvailability;
  for (const key of CANONICAL_STAT_KEYS) {
    availability[key] = false;
  }
  return availability;
}

function buildStageAvailabilityFromRawData(
  data: Record<string, unknown>
): Partial<Record<CanonicalStatKey, boolean>> {
  const availability = {} as Partial<Record<CanonicalStatKey, boolean>>;
  for (const key of CANONICAL_STAT_KEYS) {
    availability[key] = readStatPresence(data, key).hasValue;
  }
  return availability;
}

function buildStageStatsFromRawData(
  data: Record<string, unknown>
): Partial<Record<CanonicalStatKey, number | null>> {
  const stats = {} as Partial<Record<CanonicalStatKey, number | null>>;
  const availability = buildStageAvailabilityFromRawData(data);
  for (const key of CANONICAL_STAT_KEYS) {
    const value = readStat(data, key);
    stats[key] = MATCH_LOG_NULLABLE_STAT_KEYS.includes(key as (typeof MATCH_LOG_NULLABLE_STAT_KEYS)[number])
      ? (availability[key] ? value : null)
      : value;
  }
  return stats;
}

function buildStageProvenanceFromRawData(
  data: Record<string, unknown>
): Partial<Record<CanonicalStatKey, string | null>> {
  const provenance = {} as Partial<Record<CanonicalStatKey, string | null>>;
  for (const key of CANONICAL_STAT_KEYS) {
    provenance[key] = readFootywireCanonicalStatProvenance(
      data.canonical_stats,
      key
    );
  }
  return provenance;
}

function toPlayerStats(
  totals: Record<CanonicalStatKey, number>,
  gamesPlayed: number,
  averageOverrides?: Partial<PlayerStats>
): PlayerStats {
  return {
    games: gamesPlayed,
    kicks: totals.kicks,
    handballs: totals.handballs,
    marks: totals.marks,
    tackles: totals.tackles,
    goals: totals.goals,
    hitouts: totals.hitouts,
    clearances: totals.clearances,
    inside50s: totals.inside50s,
    rebound50s: totals.rebound50s,
    clangers: totals.clangers,
    contestedPossessions: totals.contestedPossessions,
    uncontestedPossessions: totals.uncontestedPossessions,
    freesFor: totals.freesFor,
    freesAgainst: totals.freesAgainst,
    onePercenters: totals.onePercenters,
    goalAssists: totals.goalAssists,
    timeOnGroundPct: averageOverrides?.timeOnGroundPct ?? totals.timeOnGroundPct,
    disposalEffPct: averageOverrides?.disposalEffPct ?? totals.disposalEffPct,
    turnovers: totals.turnovers,
    intercepts: totals.intercepts,
    metresGained: totals.metresGained,
    contestedMarks: totals.contestedMarks,
    effectiveDisposals: totals.effectiveDisposals,
    scoreInvolvements: totals.scoreInvolvements,
  };
}

function readNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function readStat(data: Record<string, unknown>, key: CanonicalStatKey): number {
  const canonicalValue = readFootywireCanonicalStatNumber(
    data.canonical_stats,
    key
  );
  if (canonicalValue.found) {
    return canonicalValue.value;
  }

  if (hasFootywireCanonicalRawMatchContract(data.canonical_stats)) {
    return 0;
  }

  return 0;
}

function readStatPresence(
  data: Record<string, unknown>,
  key: CanonicalStatKey
): { hasValue: boolean; hasNonZeroValue: boolean } {
  const canonicalPresence = readFootywireCanonicalStatPresence(
    data.canonical_stats,
    key
  );
  if (canonicalPresence.hasValue) return canonicalPresence;

  if (hasFootywireCanonicalRawMatchContract(data.canonical_stats)) {
    return { hasValue: false, hasNonZeroValue: false };
  }

  return { hasValue: false, hasNonZeroValue: false };
}

function buildAdvancedStatIntegrity(
  sourceRowsWithValue: Record<CanonicalStatKey, number>,
  sourceRowsWithNonZeroValue: Record<CanonicalStatKey, number>,
  summaryPlayersWithNonZeroValue: Record<CanonicalStatKey, number>
): AdvancedStatIntegrity {
  const degradedStats = SCORING_CRITICAL_ADVANCED_STATS.filter(
    (key) => sourceRowsWithNonZeroValue[key] > 0 && summaryPlayersWithNonZeroValue[key] === 0
  );

  return {
    sourceRowsWithValue,
    sourceRowsWithNonZeroValue,
    summaryPlayersWithNonZeroValue,
    degradedStats,
  };
}

export function getAdvancedStatIntegrityFromSummaries(
  summaries: Array<{
    stats: Record<CanonicalStatKey, number>;
    totals: Record<CanonicalStatKey, number>;
  }>
): Pick<AdvancedStatIntegrity, 'summaryPlayersWithNonZeroValue' | 'degradedStats'> {
  const summaryPlayersWithNonZeroValue = buildEmptyCoverageRecord();

  for (const summary of summaries) {
    for (const key of SCORING_CRITICAL_ADVANCED_STATS) {
      if (summary.stats[key] !== 0 || summary.totals[key] !== 0) {
        summaryPlayersWithNonZeroValue[key] += 1;
      }
    }
  }

  return {
    summaryPlayersWithNonZeroValue,
    degradedStats: SCORING_CRITICAL_ADVANCED_STATS.filter(
      (key) => summaryPlayersWithNonZeroValue[key] === 0
    ),
  };
}

function readUpdatedAt(data: Record<string, unknown>): Date {
  const values = [data.last_updated, data.updated_at, data.last_seen_at, data.updatedAt];

  for (const value of values) {
    if (value instanceof Date) return value;
    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    if (
      value &&
      typeof value === 'object' &&
      typeof (value as { toDate?: unknown }).toDate === 'function'
    ) {
      const parsed = (value as { toDate: () => Date }).toDate();
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }

  return new Date();
}

function normalizeTeamName(value: string | null | undefined): string {
  return normalizeAflTeamName(value ?? '');
}

const rawReconciliationRoundMatchCache = new Map<string, Array<Record<string, unknown>>>();

function rawReconciliationRoundKey(season: number, round: number): string {
  return `${season}:${round}`;
}

async function loadRawReconciliationRoundMatches(
  season: number,
  round: number,
  firestore: FirestoreLike = adminDb
): Promise<Array<Record<string, unknown>>> {
  const cacheKey = rawReconciliationRoundKey(season, round);
  const cached = rawReconciliationRoundMatchCache.get(cacheKey);
  if (cached) return cached;

  const byRoundNumber = await firestore
    .collection('matches')
    .where('season', '==', season)
    .where('round_number', '==', round)
    .get();

  const docs =
    !byRoundNumber.empty
      ? byRoundNumber.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      : (
          await firestore
            .collection('matches')
            .where('season', '==', season)
            .where('round', '==', round)
            .get()
        ).docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  rawReconciliationRoundMatchCache.set(cacheKey, docs);
  return docs;
}

async function fetchRawReconciliationRoundMatches(
  season: number,
  round: number,
  firestore: FirestoreLike
): Promise<Array<Record<string, unknown>>> {
  const byRoundNumber = await firestore
    .collection('matches')
    .where('season', '==', season)
    .where('round_number', '==', round)
    .get();

  if (!byRoundNumber.empty) {
    return byRoundNumber.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  return (
    await firestore
      .collection('matches')
      .where('season', '==', season)
      .where('round', '==', round)
      .get()
  ).docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

function normalizeMatchDate(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) return '';
  const dateStr = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return dateStr;

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function readCanonicalMatchMetadataValue(
  data: Record<string, unknown>,
  key: string
): unknown {
  const metadata = data.canonical_match_metadata;
  if (!metadata || typeof metadata !== 'object') return undefined;
  return (metadata as Record<string, unknown>)[key];
}

function resolveCanonicalMatchDate(data: Record<string, unknown>): string {
  const rawRow = (data.raw_row as Record<string, unknown> | undefined) ?? {};

  return normalizeMatchDate(
    readCanonicalMatchMetadataValue(data, 'match_date') ??
      data.match_date ??
      readCanonicalMatchMetadataValue(data, 'start_time_utc') ??
      data.start_time_utc ??
      data.date ??
      rawRow.match_date ??
      rawRow.date
  );
}

function buildPlayerGameAggregationKey(params: {
  playerId: string;
  season: number;
  roundNumber: number | null;
  matchId: string;
  matchDate: string;
  opponent: string;
}): string {
  const matchId = params.matchId.trim();
  if (matchId.length > 0) {
    return `${params.playerId}|match|${matchId}`.toLowerCase();
  }

  return `${params.playerId}|${params.season}|${params.roundNumber ?? 0}|${params.matchDate}|${params.opponent}`.toLowerCase();
}

function countAvailableStats(data: Record<string, unknown>): number {
  let count = 0;
  for (const key of CANONICAL_STAT_KEYS) {
    if (readStatPresence(data, key).hasValue) {
      count += 1;
    }
  }
  return count;
}

function countNonZeroStats(data: Record<string, unknown>): number {
  let count = 0;
  for (const key of CANONICAL_STAT_KEYS) {
    if (readStatPresence(data, key).hasNonZeroValue) {
      count += 1;
    }
  }
  return count;
}

function shouldReplaceAggregatedPlayerMatch(
  existing: {
    data: Record<string, unknown>;
    updatedAt: Date;
  },
  candidate: {
    data: Record<string, unknown>;
    updatedAt: Date;
  }
): boolean {
  const existingCanonical = hasFootywireCanonicalRawMatchContract(existing.data.canonical_stats);
  const candidateCanonical = hasFootywireCanonicalRawMatchContract(candidate.data.canonical_stats);

  if (candidateCanonical && !existingCanonical) return true;
  if (!candidateCanonical && existingCanonical) return false;

  const existingAvailable = countAvailableStats(existing.data);
  const candidateAvailable = countAvailableStats(candidate.data);
  if (candidateAvailable !== existingAvailable) {
    return candidateAvailable > existingAvailable;
  }

  const existingNonZero = countNonZeroStats(existing.data);
  const candidateNonZero = countNonZeroStats(candidate.data);
  if (candidateNonZero !== existingNonZero) {
    return candidateNonZero > existingNonZero;
  }

  return candidate.updatedAt.getTime() > existing.updatedAt.getTime();
}

async function selectBestCanonicalRawRows(params: {
  docs: FirebaseFirestore.QueryDocumentSnapshot[];
  season: number;
  firestore: FirestoreLike;
  playerMap: Map<
    string,
    { id: string; name: string; club: string; position: string | null; active: boolean | null }
  >;
  playerIdentityResolver: ReturnType<typeof createPlayerIdentityResolver>;
  playerId?: string;
}): Promise<{
  rows: SelectedCanonicalRawRow[];
  skippedWithoutCanonicalId: number;
  fallbackResolvedPlayerProfiles: number;
  skippedWithoutResolvedPlayerProfile: number;
}> {
  const bestRawRowsByPlayerGame = new Map<string, SelectedCanonicalRawRow>();
  let skippedWithoutCanonicalId = 0;
  let fallbackResolvedPlayerProfiles = 0;
  let skippedWithoutResolvedPlayerProfile = 0;
  const roundMatchesByRound = new Map<string, Array<Record<string, unknown>>>();

  for (const doc of params.docs) {
    const data = doc.data() as Record<string, unknown>;
    const canonicalPlayerId = readCanonicalPlayerId(data);
    const playerId =
      canonicalPlayerId && params.playerMap.has(canonicalPlayerId)
        ? canonicalPlayerId
        : resolveCanonicalPlayerIdFromRecord(data, params.playerIdentityResolver);
    if (!playerId) {
      skippedWithoutCanonicalId += 1;
      continue;
    }
    if (params.playerId && playerId !== params.playerId && canonicalPlayerId !== params.playerId) {
      continue;
    }
    if (canonicalPlayerId && canonicalPlayerId !== playerId) {
      fallbackResolvedPlayerProfiles += 1;
    }

    const playerProfile = params.playerMap.get(playerId);
    if (!playerProfile) {
      skippedWithoutResolvedPlayerProfile += 1;
      continue;
    }

    const updatedAt = readUpdatedAt(data);
    const season = readNumber(data.season) || params.season;
    const roundNumber = readNumber(data.round_number ?? data.round);
    let roundMatches: Array<Record<string, unknown>> = [];
    if (season && roundNumber != null) {
      const roundMatchKey = rawReconciliationRoundKey(season, roundNumber);
      roundMatches = roundMatchesByRound.get(roundMatchKey) ?? [];
      if (!roundMatchesByRound.has(roundMatchKey)) {
        roundMatches = await fetchRawReconciliationRoundMatches(season, roundNumber, params.firestore);
        roundMatchesByRound.set(roundMatchKey, roundMatches);
      }
    }
    const storageMatchId = readCanonicalMatchKey(data);
    const matchResolution = resolveCanonicalMatchContextFromRecord(data, roundMatches);
    if (roundMatches.length > 0 && !matchResolution.matched) {
      continue;
    }
    const matchId = matchResolution.matchId ?? storageMatchId;
    const playerName =
      typeof data.player_name === 'string' && data.player_name.trim().length > 0
        ? data.player_name.trim()
        : playerProfile.name;
    const opponent = resolveOpponent(data, playerProfile.club);
    const matchDate = resolveCanonicalMatchDate(data);
    const aggregationKey = buildPlayerGameAggregationKey({
      playerId,
      season,
      roundNumber,
      matchId,
      matchDate,
      opponent,
    });

    const candidate: SelectedCanonicalRawRow = {
      data,
      playerId,
      storagePlayerId: canonicalPlayerId,
      playerProfile,
      playerName,
      matchId,
      storageMatchId,
      season,
      roundNumber,
      opponent,
      matchDate,
      updatedAt,
    };
    const existingBestRow = bestRawRowsByPlayerGame.get(aggregationKey);
    if (
      !existingBestRow ||
      shouldReplaceAggregatedPlayerMatch(existingBestRow, candidate)
    ) {
      bestRawRowsByPlayerGame.set(aggregationKey, candidate);
    }
  }

  return {
    rows: Array.from(bestRawRowsByPlayerGame.values()),
    skippedWithoutCanonicalId,
    fallbackResolvedPlayerProfiles,
    skippedWithoutResolvedPlayerProfile,
  };
}

function resolveOpponent(data: Record<string, unknown>, playerClub: string): string {
  const team = normalizeTeamName(playerClub);
  const rawRow = (data.raw_row as Record<string, unknown> | undefined) ?? {};
  const rawHome = data.match_home_team ?? rawRow.match_home_team ?? rawRow.match_home_team_name;
  const rawAway = data.match_away_team ?? rawRow.match_away_team ?? rawRow.match_away_team_name;
  const home = normalizeTeamName(typeof rawHome === 'string' ? rawHome : undefined);
  const away = normalizeTeamName(typeof rawAway === 'string' ? rawAway : undefined);

  if (team && home && away) {
    if (team.toLowerCase() === home.toLowerCase()) return away;
    if (team.toLowerCase() === away.toLowerCase()) return home;
  }

  const fallback = data.opposition ?? rawRow.opposition ?? data.opponent;
  return normalizeTeamName(typeof fallback === 'string' ? fallback : undefined) || 'Unknown';
}

function addInto(
  destination: Record<CanonicalStatKey, number>,
  source: Record<CanonicalStatKey, number>
): void {
  for (const key of CANONICAL_STAT_KEYS) {
    destination[key] = (destination[key] ?? 0) + (source[key] ?? 0);
  }
}

function divideStats(
  totals: Record<CanonicalStatKey, number>,
  gamesPlayed: number
): Record<CanonicalStatKey, number> {
  if (gamesPlayed <= 0) return buildEmptyStats();
  const result = buildEmptyStats();
  for (const key of CANONICAL_STAT_KEYS) {
    result[key] = totals[key] / gamesPlayed;
  }
  return result;
}

type MatchLogStatsJsonPayload = {
  stats: Record<CanonicalStatKey, number>;
  availability?: MatchLogStatAvailability;
};

function toMatchLogStats(
  stats: Record<CanonicalStatKey, number>,
  availability?: MatchLogStatAvailability
): MatchLogStats {
  const matchLogStats = { ...stats } as MatchLogStats;

  if (!availability) {
    return matchLogStats;
  }

  for (const key of MATCH_LOG_NULLABLE_STAT_KEYS) {
    if (availability[key] === false) {
      matchLogStats[key] = null;
    }
  }

  return matchLogStats;
}

function serializeStats(stats: Record<CanonicalStatKey, number>): string {
  return JSON.stringify(stats);
}

function serializeMatchLogStats(
  stats: MatchLogStats,
  availability?: MatchLogStatAvailability
): string {
  const numericStats = buildEmptyStats();
  for (const key of CANONICAL_STAT_KEYS) {
    numericStats[key] = readNumber(stats[key]);
  }

  const payload: MatchLogStatsJsonPayload = {
    stats: numericStats,
  };

  const resolvedAvailability = availability ?? buildMatchLogStatAvailability();
  let hasAvailability = false;
  for (const key of CANONICAL_STAT_KEYS) {
    const available = availability?.[key] ?? stats[key] !== null;
    resolvedAvailability[key] = available;
    if (!available) {
      hasAvailability = true;
    }
  }

  if (hasAvailability) {
    payload.availability = resolvedAvailability;
  }

  return JSON.stringify(payload);
}

/** Exported for unit tests — prefer `getPlayerSeasonSummaryMap` in application code. */
export function parseStatsJson(raw: string | null | undefined): Record<CanonicalStatKey, number> {
  if (!raw) return buildEmptyStats();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const stats = buildEmptyStats();
    const canonicalKeySet = new Set<string>(CANONICAL_STAT_KEYS);

    for (const [rawKey, value] of Object.entries(parsed)) {
      const canonical = canonicalKeySet.has(rawKey)
        ? (rawKey as CanonicalStatKey)
        : canonicalStatKeyFromRaw(rawKey);
      if (!canonical) continue;
      stats[canonical] = readNumber(value);
    }

    for (const key of CANONICAL_STAT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(parsed, key)) {
        stats[key] = readNumber(parsed[key]);
      }
    }

    return stats;
  } catch {
    return buildEmptyStats();
  }
}

export function parseMatchLogStatsJson(raw: string | null | undefined): MatchLogStats {
  return parseMatchLogStatsPayload(raw).stats;
}

function parseMatchLogStatsPayload(raw: string | null | undefined): {
  stats: MatchLogStats;
  availability: MatchLogStatAvailability;
} {
  if (!raw) {
    return {
      stats: toMatchLogStats(buildEmptyStats(), buildMatchLogStatAvailability()),
      availability: buildMatchLogStatAvailability(),
    };
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const hasNestedStats = parsed && typeof parsed === 'object' && 'stats' in parsed;
    const numericStats = parseStatsJson(
      JSON.stringify(hasNestedStats ? (parsed.stats as Record<string, unknown>) : parsed)
    );
    const availability = buildMatchLogStatAvailability();

    if (hasNestedStats && parsed.availability && typeof parsed.availability === 'object') {
      for (const key of CANONICAL_STAT_KEYS) {
        const candidate = (parsed.availability as Record<string, unknown>)[key];
        if (typeof candidate === 'boolean') {
          availability[key] = candidate;
        }
      }
    } else {
      for (const key of CANONICAL_STAT_KEYS) {
        availability[key] = MATCH_LOG_NULLABLE_STAT_KEYS.includes(
          key as (typeof MATCH_LOG_NULLABLE_STAT_KEYS)[number]
        )
          ? numericStats[key] !== null
          : true;
      }
    }

    return {
      stats: toMatchLogStats(numericStats, availability),
      availability,
    };
  } catch {
    return {
      stats: toMatchLogStats(buildEmptyStats(), buildMatchLogStatAvailability()),
      availability: buildMatchLogStatAvailability(),
    };
  }
}

function serializeCategories(row: PlayerSeasonSummaryRow): string {
  return JSON.stringify({
    goals: row.stats.goals,
    tackles: row.stats.tackles,
    inside50s: row.stats.inside50s,
    intercepts: row.stats.intercepts,
    contestedMarks: row.stats.contestedMarks,
    rebound50s: row.stats.rebound50s,
    contestedPossessions: row.stats.contestedPossessions,
    effectiveDisposals: row.stats.effectiveDisposals,
    scoreInvolvements: row.stats.scoreInvolvements,
  });
}

function parseNumberArrayJson(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(readNumber) : [];
  } catch {
    return [];
  }
}

async function loadAllPlayersMap(prismaClient: PrismaReadWriteClient) {
  const players = await prismaClient.player.findMany({
    select: { id: true, name: true, club: true, position: true, active: true },
  });
  return {
    playerMap: new Map(players.map((player) => [player.id, player] as const)),
    playerIdentityResolver: createPlayerIdentityResolver(players),
  };
}

export function resolveRawReconciliationPlayerId(
  data: Record<string, unknown>,
  resolver: ReturnType<typeof createPlayerIdentityResolver>
): {
  storagePlayerId: string | null;
  playerId: string | null;
} {
  const storagePlayerId = readCanonicalPlayerId(data);
  const playerId = resolveCanonicalPlayerIdFromRecord(data, resolver);
  return {
    storagePlayerId,
    playerId,
  };
}

export function resolveCanonicalMatchIdFromRecord(
  data: Record<string, unknown>,
  roundMatches: Array<Record<string, unknown>>
): string | null {
  return resolveCanonicalMatchContextFromRecord(data, roundMatches).matchId;
}

function resolveCanonicalMatchContextFromRecord(
  data: Record<string, unknown>,
  roundMatches: Array<Record<string, unknown>>
): {
  matchId: string | null;
  matched: boolean;
} {
  const storageMatchId = readCanonicalMatchKey(data);
  const rawRow = (data.raw_row as Record<string, unknown> | undefined) ?? {};

  const rawHome = data.match_home_team ?? rawRow.match_home_team ?? rawRow.match_home_team_name;
  const rawAway = data.match_away_team ?? rawRow.match_away_team ?? rawRow.match_away_team_name;
  const home = normalizeTeamName(typeof rawHome === 'string' ? rawHome : undefined);
  const away = normalizeTeamName(typeof rawAway === 'string' ? rawAway : undefined);
  const team = normalizeTeamName(typeof data.team === 'string' ? data.team : undefined);
  const opposition = normalizeTeamName(
    typeof data.opposition === 'string'
      ? data.opposition
      : typeof rawRow.opposition === 'string'
        ? rawRow.opposition
        : undefined
  );

  const matched = roundMatches.find((candidate) => {
    const candidateHome = normalizeTeamName(
      typeof candidate.home_team === 'string' ? candidate.home_team : undefined
    );
    const candidateAway = normalizeTeamName(
      typeof candidate.away_team === 'string' ? candidate.away_team : undefined
    );
    if (!candidateHome || !candidateAway) return false;

    if (home && away) {
      return candidateHome === home && candidateAway === away;
    }

    if (team && opposition) {
      return (
        (candidateHome === team && candidateAway === opposition) ||
        (candidateHome === opposition && candidateAway === team)
      );
    }

    return false;
  });

  const matchedMatchId =
    (typeof matched?.match_uid === 'string' && matched.match_uid.trim()) ||
    (typeof matched?.matchUid === 'string' && matched.matchUid.trim()) ||
    (typeof matched?.match_id === 'string' && matched.match_id.trim()) ||
    (typeof matched?.id === 'string' && matched.id.trim()) ||
    null;

  return {
    matchId: matchedMatchId ?? storageMatchId,
    matched: Boolean(matchedMatchId) || roundMatches.length === 0,
  };
}

export async function resolveRawReconciliationIdentity(
  data: Record<string, unknown>,
  resolver: ReturnType<typeof createPlayerIdentityResolver>
): Promise<{
  storagePlayerId: string | null;
  playerId: string | null;
  storageMatchId: string | null;
  matchId: string;
}> {
  const { storagePlayerId, playerId } = resolveRawReconciliationPlayerId(data, resolver);
  const season = readNumber(data.season);
  const roundNumber = readNumber(data.round_number ?? data.round);
  const storageMatchId = readCanonicalMatchKey(data);

  if (!season || !roundNumber) {
    return {
      storagePlayerId,
      playerId,
      storageMatchId,
      matchId: storageMatchId,
    };
  }

  const roundMatches = await loadRawReconciliationRoundMatches(season, roundNumber);
  return {
    storagePlayerId,
    playerId,
    storageMatchId,
    matchId: resolveCanonicalMatchIdFromRecord(data, roundMatches) ?? storageMatchId,
  };
}

async function listPlayerMatchStatDocsForSeason(params: {
  season: number;
  firestore: FirestoreLike;
  prismaClient: PrismaReadWriteClient;
  playerMap: Map<
    string,
    { id: string; name: string; club: string; position: string | null; active: boolean | null }
  >;
  playerIds?: string[];
}): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  if (!params.playerIds || params.playerIds.length === 0) {
    const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    const pageSize = 1000;

    while (true) {
      let query = params.firestore
        .collection('player_match_stats')
        .where('season', '==', params.season)
        .orderBy('__name__')
        .limit(pageSize);

      if (cursor) {
        query = query.startAfter(cursor);
      }

      const snapshot = await query.get();
      if (snapshot.empty) break;
      docs.push(...snapshot.docs);
      cursor = snapshot.docs[snapshot.docs.length - 1];
      if (snapshot.size < pageSize) break;
    }

    return docs;
  }

  const dedupedPlayerIds = [...new Set(params.playerIds)].filter((value) => value.length > 0);
  const aliases = await params.prismaClient.playerAlias.findMany({
    where: { playerId: { in: dedupedPlayerIds } },
    select: { playerId: true, aliasName: true },
  });
  const storagePlayerIdCandidates = new Set(dedupedPlayerIds);

  for (const playerId of dedupedPlayerIds) {
    const player = params.playerMap.get(playerId);
    if (player?.name) {
      storagePlayerIdCandidates.add(buildCanonicalPlayerId(player.name));
    }
  }
  for (const alias of aliases) {
    if (alias.aliasName) {
      storagePlayerIdCandidates.add(buildCanonicalPlayerId(alias.aliasName));
    }
  }

  const queryPlayerIds = [...storagePlayerIdCandidates].filter((value) => value.length > 0);
  const docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];

  for (let index = 0; index < queryPlayerIds.length; index += 10) {
    const chunk = queryPlayerIds.slice(index, index + 10);
    const snapshot = await params.firestore
      .collection('player_match_stats')
      .where('season', '==', params.season)
      .where('player_id', 'in', chunk)
      .get();
    docs.push(...snapshot.docs);
  }

  return docs;
}

export async function buildPlayerSeasonSummaries(params: {
  season: number;
  firestore?: FirestoreLike;
  prismaClient?: PrismaReadWriteClient;
  playerIds?: string[];
}): Promise<{
  summaries: PlayerSeasonSummaryRow[];
  recentFormSummaries: PlayerRecentFormSummaryRow[];
  latestSnapshots: PlayerLatestSnapshotRow[];
  matchLogProjections: PlayerMatchLogProjectionRow[];
  skippedWithoutCanonicalId: number;
  fallbackResolvedPlayerProfiles: number;
  skippedWithoutResolvedPlayerProfile: number;
  integrity: AdvancedStatIntegrity;
}> {
  const firestore = params.firestore ?? adminDb;
  const prismaClient = params.prismaClient ?? prisma;
  const { playerMap, playerIdentityResolver } = await loadAllPlayersMap(prismaClient);
  const aggregates = new Map<string, AggregatedPlayer>();
  const matchesByPlayer = new Map<string, PlayerMatchProjection[]>();
  const sourceRowsWithValue = buildEmptyCoverageRecord();
  const sourceRowsWithNonZeroValue = buildEmptyCoverageRecord();

  const docs = await listPlayerMatchStatDocsForSeason({
    season: params.season,
    firestore,
    prismaClient,
    playerMap,
    playerIds: params.playerIds,
  });

  for (const doc of docs) {
      const data = doc.data() as Record<string, unknown>;
      for (const statKey of SCORING_CRITICAL_ADVANCED_STATS) {
        const presence = readStatPresence(data, statKey);
        if (presence.hasValue) {
          sourceRowsWithValue[statKey] += 1;
        }
        if (presence.hasNonZeroValue) {
          sourceRowsWithNonZeroValue[statKey] += 1;
        }
      }
  }

  const {
    rows: selectedRows,
    skippedWithoutCanonicalId,
    fallbackResolvedPlayerProfiles,
    skippedWithoutResolvedPlayerProfile,
  } = await selectBestCanonicalRawRows({
    docs,
    season: params.season,
    firestore,
    playerMap,
    playerIdentityResolver,
  });

  for (const row of selectedRows) {
      const { data, playerId, playerProfile, matchId, updatedAt, season, roundNumber, opponent, matchDate } = row;
      const existing: AggregatedPlayer = aggregates.get(playerId) ?? {
        playerId,
        playerName:
          typeof data.player_name === 'string' && data.player_name.trim().length > 0
            ? data.player_name.trim()
            : playerProfile.name,
        club: playerProfile.club,
        position: playerProfile.position ?? '',
        totals: buildEmptyStats(),
        gamesPlayed: 0,
        lastUpdatedAt: updatedAt,
        seenMatchKeys: new Set<string>(),
      };

      if (existing.seenMatchKeys.has(matchId)) continue;
      existing.seenMatchKeys.add(matchId);
      existing.gamesPlayed += 1;

      const matchTotals = buildEmptyStats();
      const matchAvailability = buildMatchLogStatAvailability();
      matchTotals.behinds = readStat(data, 'behinds');
      matchTotals.kicks = readStat(data, 'kicks');
      matchTotals.handballs = readStat(data, 'handballs');
      matchTotals.disposals = readStat(data, 'disposals');
      matchTotals.marks = readStat(data, 'marks');
      matchTotals.tackles = readStat(data, 'tackles');
      matchTotals.goals = readStat(data, 'goals');
      matchTotals.hitouts = readStat(data, 'hitouts');
      matchTotals.clearances = readStat(data, 'clearances');
      matchTotals.inside50s = readStat(data, 'inside50s');
      matchTotals.rebound50s = readStat(data, 'rebound50s');
      matchTotals.clangers = readStat(data, 'clangers');
      matchTotals.contestedPossessions = readStat(data, 'contestedPossessions');
      matchTotals.uncontestedPossessions = readStat(data, 'uncontestedPossessions');
      matchTotals.freesFor = readStat(data, 'freesFor');
      matchTotals.freesAgainst = readStat(data, 'freesAgainst');
      matchTotals.onePercenters = readStat(data, 'onePercenters');
      matchTotals.goalAssists = readStat(data, 'goalAssists');
      matchTotals.timeOnGroundPct = readStat(data, 'timeOnGroundPct');
      matchTotals.minutes = readStat(data, 'minutes');
      matchTotals.disposalEffPct = readStat(data, 'disposalEffPct');
      matchTotals.turnovers = readStat(data, 'turnovers');
      matchTotals.intercepts = readStat(data, 'intercepts');
      matchTotals.metresGained = readStat(data, 'metresGained');
      matchTotals.contestedMarks = readStat(data, 'contestedMarks');
      matchTotals.effectiveDisposals = readStat(data, 'effectiveDisposals');
      matchTotals.scoreInvolvements = readStat(data, 'scoreInvolvements');
      for (const key of CANONICAL_STAT_KEYS) {
        matchAvailability[key] = readStatPresence(data, key).hasValue;
      }

      addInto(existing.totals, matchTotals);
      const matchEntry: PlayerMatchProjection = {
        matchKey: matchId,
        matchUid: matchId,
        season,
        round: roundNumber,
        matchDate,
        opponent,
        totals: matchTotals,
        statAvailability: matchAvailability,
        updatedAt,
        lastSeenAt: updatedAt,
        isLive: String(data.status ?? '').toLowerCase() === 'in_progress',
      };
      const existingMatches = matchesByPlayer.get(playerId) ?? [];
      existingMatches.push(matchEntry);
      matchesByPlayer.set(playerId, existingMatches);

      if (updatedAt.getTime() > existing.lastUpdatedAt.getTime()) {
        existing.lastUpdatedAt = updatedAt;
      }

      aggregates.set(playerId, existing);
  }

  if (skippedWithoutCanonicalId > 0) {
    logger.warn('buildPlayerSeasonSummaries skipped records without canonical player_id', {
      season: params.season,
      skippedWithoutCanonicalId,
    });
  }
  if (fallbackResolvedPlayerProfiles > 0) {
    logger.info('buildPlayerSeasonSummaries resolved raw player ids via shared player identity fallback', {
      season: params.season,
      fallbackResolvedPlayerProfiles,
    });
  }
  if (skippedWithoutResolvedPlayerProfile > 0) {
    logger.warn('buildPlayerSeasonSummaries skipped records without a resolved Prisma player profile', {
      season: params.season,
      skippedWithoutResolvedPlayerProfile,
    });
  }

  const summaries: PlayerSeasonSummaryRow[] = [];
  const recentFormSummaries: PlayerRecentFormSummaryRow[] = [];
  const latestSnapshots: PlayerLatestSnapshotRow[] = [];
  const matchLogProjections: PlayerMatchLogProjectionRow[] = [];
  const recentWindows = [
    { key: 'last3', size: 3 },
    { key: 'last5', size: 5 },
    { key: 'last10', size: 10 },
  ] as const;
  for (const aggregate of aggregates.values()) {
    const stats = divideStats(aggregate.totals, aggregate.gamesPlayed);
    const totalValue = calculateTotalValue(
      toPlayerStats(aggregate.totals, aggregate.gamesPlayed, {
        timeOnGroundPct: stats.timeOnGroundPct,
        disposalEffPct: stats.disposalEffPct,
      })
    );
    summaries.push({
      id: `${aggregate.playerId}:${params.season}`,
      playerId: aggregate.playerId,
      season: params.season,
      playerName: aggregate.playerName,
      club: aggregate.club,
      position: aggregate.position,
      gamesPlayed: aggregate.gamesPlayed,
      averageScore: aggregate.gamesPlayed > 0 ? totalValue / aggregate.gamesPlayed : 0,
      totalValue,
      stats,
      totals: aggregate.totals,
      sourceUpdatedAt: aggregate.lastUpdatedAt,
    });

    const dedupedMatches = (matchesByPlayer.get(aggregate.playerId) ?? [])
      .slice()
      .sort((a, b) => {
        const roundDiff = (b.round ?? -1) - (a.round ?? -1);
        if (roundDiff !== 0) return roundDiff;
        return b.updatedAt.getTime() - a.updatedAt.getTime();
      });

    const dedupedMatchLogs = dedupeByDateOpponent(
      dedupedMatches.map(
        (match) =>
          ({
            matchId: match.matchUid ?? match.matchKey,
            season: match.season,
            roundNumber: match.round ?? 0,
            date: match.matchDate,
            opponent: match.opponent,
            stats: toMatchLogStats(match.totals, match.statAvailability),
            statAvailability: match.statAvailability,
          }) satisfies MatchLogRow
      )
    ).sort((a, b) => {
      const dateDiff = b.date.localeCompare(a.date);
      if (dateDiff !== 0) return dateDiff;
      return b.roundNumber - a.roundNumber;
    });

    for (const match of dedupedMatchLogs) {
      const sourceUpdatedAt =
        dedupedMatches.find(
          (candidate) =>
            candidate.season === match.season &&
            (candidate.matchUid ?? candidate.matchKey) === match.matchId &&
            candidate.round === match.roundNumber &&
            candidate.matchDate === match.date &&
            candidate.opponent === match.opponent
        )?.updatedAt ?? aggregate.lastUpdatedAt;

      matchLogProjections.push({
        id: `${aggregate.playerId}:${match.season}:${match.matchId}`,
        playerId: aggregate.playerId,
        season: match.season,
        roundNumber: match.roundNumber,
        matchId: match.matchId,
        matchDate: match.date,
        opponent: match.opponent,
        stats: match.stats,
        statAvailability: match.statAvailability,
        sourceUpdatedAt,
      });
    }

    const latestMatch = dedupedMatches[0];
    if (latestMatch) {
      const latestStats = divideStats(latestMatch.totals, 1);
      const latestTotalValue = calculateTotalValue(
        toPlayerStats(latestMatch.totals, 1, {
          timeOnGroundPct: latestStats.timeOnGroundPct,
          disposalEffPct: latestStats.disposalEffPct,
        })
      );
      latestSnapshots.push({
        id: `${aggregate.playerId}:${params.season}`,
        playerId: aggregate.playerId,
        season: params.season,
        matchUid: latestMatch.matchUid,
        round: latestMatch.round,
        statSource: latestMatch.isLive ? 'live' : 'final',
        isLive: latestMatch.isLive,
        lastSeenAt: latestMatch.lastSeenAt,
        averageScore: latestTotalValue,
        totalValue: latestTotalValue,
        stats: latestStats,
        totals: latestMatch.totals,
        sourceUpdatedAt: latestMatch.updatedAt,
      });
    }

    for (const windowDef of recentWindows) {
      const matches = dedupedMatches.slice(0, windowDef.size);
      if (matches.length === 0) continue;
      const totals = buildEmptyStats();
      let sourceUpdatedAt = matches[0]?.updatedAt ?? aggregate.lastUpdatedAt;
      for (const match of matches) {
        addInto(totals, match.totals);
        if (match.updatedAt.getTime() > sourceUpdatedAt.getTime()) {
          sourceUpdatedAt = match.updatedAt;
        }
      }
      const windowStats = divideStats(totals, matches.length);
      const windowTotalValue = calculateTotalValue(
        toPlayerStats(totals, matches.length, {
          timeOnGroundPct: windowStats.timeOnGroundPct,
          disposalEffPct: windowStats.disposalEffPct,
        })
      );
      recentFormSummaries.push({
        id: `${aggregate.playerId}:${params.season}:${windowDef.key}`,
        playerId: aggregate.playerId,
        season: params.season,
        window: windowDef.key,
        gamesIncluded: matches.length,
        averageScore: matches.length > 0 ? windowTotalValue / matches.length : 0,
        totalValue: windowTotalValue,
        stats: windowStats,
        totals,
        sourceUpdatedAt,
      });
    }
  }

  summaries.sort((a, b) => b.totalValue - a.totalValue);
  const { summaryPlayersWithNonZeroValue } = getAdvancedStatIntegrityFromSummaries(summaries);
  return {
    summaries,
    recentFormSummaries,
    latestSnapshots,
    matchLogProjections,
    skippedWithoutCanonicalId,
    fallbackResolvedPlayerProfiles,
    skippedWithoutResolvedPlayerProfile,
    integrity: buildAdvancedStatIntegrity(
      sourceRowsWithValue,
      sourceRowsWithNonZeroValue,
      summaryPlayersWithNonZeroValue
    ),
  };
}

export async function persistPlayerSeasonSummaries(
  prismaClient: PrismaReadWriteClient,
  season: number,
  summaries: PlayerSeasonSummaryRow[],
  playerIds?: string[]
): Promise<void> {
  await prismaClient.playerSeasonSummary.deleteMany({
    where: playerIds && playerIds.length > 0 ? { season, playerId: { in: playerIds } } : { season },
  });

  if (summaries.length === 0) return;

  for (let index = 0; index < summaries.length; index += 250) {
    const chunk = summaries.slice(index, index + 250);
    await prismaClient.playerSeasonSummary.createMany({
      data: chunk.map((summary) => ({
        id: summary.id,
        playerId: summary.playerId,
        season: summary.season,
        playerName: summary.playerName,
        club: summary.club,
        position: summary.position,
        gamesPlayed: summary.gamesPlayed,
        averageScore: summary.averageScore,
        totalValue: summary.totalValue,
        statsJson: serializeStats(summary.stats),
        totalsJson: serializeStats(summary.totals),
        sourceUpdatedAt: summary.sourceUpdatedAt,
      })),
    });
  }
}

export async function persistPlayerRecentFormSummaries(
  prismaClient: PrismaReadWriteClient,
  season: number,
  rows: PlayerRecentFormSummaryRow[],
  playerIds?: string[]
): Promise<void> {
  await prismaClient.playerRecentFormSummary.deleteMany({
    where: playerIds && playerIds.length > 0 ? { season, playerId: { in: playerIds } } : { season },
  });

  if (rows.length === 0) return;

  for (let index = 0; index < rows.length; index += 250) {
    const chunk = rows.slice(index, index + 250);
    await prismaClient.playerRecentFormSummary.createMany({
      data: chunk.map((row) => ({
        id: row.id,
        playerId: row.playerId,
        season: row.season,
        window: row.window,
        gamesIncluded: row.gamesIncluded,
        averageScore: row.averageScore,
        totalValue: row.totalValue,
        statsJson: serializeStats(row.stats),
        totalsJson: serializeStats(row.totals),
        sourceUpdatedAt: row.sourceUpdatedAt,
      })),
    });
  }
}

export async function persistPlayerLatestSnapshots(
  prismaClient: PrismaReadWriteClient,
  season: number,
  rows: PlayerLatestSnapshotRow[],
  playerIds?: string[]
): Promise<void> {
  await prismaClient.playerLatestSnapshot.deleteMany({
    where: playerIds && playerIds.length > 0 ? { season, playerId: { in: playerIds } } : { season },
  });

  if (rows.length === 0) return;

  for (let index = 0; index < rows.length; index += 250) {
    const chunk = rows.slice(index, index + 250);
    await prismaClient.playerLatestSnapshot.createMany({
      data: chunk.map((row) => ({
        id: row.id,
        playerId: row.playerId,
        season: row.season,
        matchUid: row.matchUid,
        round: row.round,
        statSource: row.statSource,
        isLive: row.isLive,
        lastSeenAt: row.lastSeenAt,
        averageScore: row.averageScore,
        totalValue: row.totalValue,
        statsJson: serializeStats(row.stats),
        totalsJson: serializeStats(row.totals),
        sourceUpdatedAt: row.sourceUpdatedAt,
      })),
    });
  }
}

export async function persistPlayerMatchLogProjections(
  prismaClient: PrismaReadWriteClient,
  season: number,
  rows: PlayerMatchLogProjectionRow[],
  playerIds?: string[],
  rounds?: number[]
): Promise<void> {
  const scopedRounds = [...new Set(rounds ?? [])].sort((a, b) => a - b);
  const rowsToPersist =
    scopedRounds.length > 0
      ? rows.filter((row) => scopedRounds.includes(row.roundNumber))
      : rows;
  await prismaClient.playerMatchLogProjection.deleteMany({
    where:
      scopedRounds.length > 0
        ? { season, roundNumber: { in: scopedRounds } }
        : playerIds && playerIds.length > 0
          ? { season, playerId: { in: playerIds } }
          : { season },
  });

  if (rowsToPersist.length === 0) return;

  for (let index = 0; index < rowsToPersist.length; index += 250) {
    const chunk = rowsToPersist.slice(index, index + 250);
    await prismaClient.playerMatchLogProjection.createMany({
      data: chunk.map((row) => ({
        id: row.id,
        playerId: row.playerId,
        season: row.season,
        roundNumber: row.roundNumber,
        matchId: row.matchId,
        matchDate: row.matchDate,
        opponent: row.opponent,
        statsJson: serializeMatchLogStats(row.stats, row.statAvailability),
        sourceUpdatedAt: row.sourceUpdatedAt,
      })),
    });
  }
}

export function buildPlayerRankingSnapshots(
  season: number,
  summaries: PlayerSeasonSummaryRow[],
  scope = 'season',
  snapshotAt = new Date()
): PlayerRankingSnapshotRow[] {
  return buildPlayerRankingRows(summaries).map((summary, index) => ({
    id: `${season}:${scope}:${PLAYER_RANKING_METHOD}:${PLAYER_RANKING_METHOD_VERSION}:${summary.playerId}`,
    season,
    scope,
    method: PLAYER_RANKING_METHOD,
    methodVersion: PLAYER_RANKING_METHOD_VERSION,
    rank: index + 1,
    playerId: summary.playerId,
    playerName: summary.playerName,
    club: summary.club,
    position: summary.position,
    gamesPlayed: summary.gamesPlayed,
    averageScore: summary.averageScore,
    totalValue: summary.totalValue,
    rankingValue: summary.rankingValue,
    minimumGames: summary.minimumGames,
    populationSize: summary.populationSize,
    isSmallSample: summary.isSmallSample,
    categories: summary.categories,
    stats: summary.stats,
    totals: summary.totals,
    metadata: summary.metadata,
    snapshotAt,
  }));
}

export async function persistPlayerRankingSnapshots(
  prismaClient: PrismaReadWriteClient,
  season: number,
  rows: PlayerRankingSnapshotRow[],
  scope = 'season'
): Promise<void> {
  await prismaClient.playerRankingSnapshot.deleteMany({
    where: {
      season,
      scope,
      method: PLAYER_RANKING_METHOD,
      methodVersion: PLAYER_RANKING_METHOD_VERSION,
    },
  });

  if (rows.length === 0) return;

  for (let index = 0; index < rows.length; index += 250) {
    const chunk = rows.slice(index, index + 250);
    await prismaClient.playerRankingSnapshot.createMany({
      data: chunk.map((row) => ({
        id: row.id,
        season: row.season,
        scope: row.scope,
        method: row.method,
        methodVersion: row.methodVersion,
        rank: row.rank,
        playerId: row.playerId,
        playerName: row.playerName,
        club: row.club,
        position: row.position,
        gamesPlayed: row.gamesPlayed,
        averageScore: row.averageScore,
        totalValue: row.totalValue,
        rankingValue: row.rankingValue,
        minimumGames: row.minimumGames,
        populationSize: row.populationSize,
        isSmallSample: row.isSmallSample,
        categoriesJson: JSON.stringify(row.categories),
        statsJson: serializeStats(row.stats),
        totalsJson: serializeStats(row.totals),
        metadataJson: row.metadata ? JSON.stringify(row.metadata) : null,
        snapshotAt: row.snapshotAt,
      })),
    });
  }
}

/** Exported for unit tests — production callers should use `refreshPlayerReadModels`. */
export async function listCanonicalPlayerIdsForRounds(params: {
  season: number;
  rounds: number[];
  firestore: FirestoreLike;
  prismaClient: PrismaReadWriteClient;
}): Promise<string[]> {
  const { playerIdentityResolver } = await loadAllPlayersMap(params.prismaClient);
  const playerIds = new Set<string>();

  for (const round of [...new Set(params.rounds)].sort((a, b) => a - b)) {
    const snapshot = await params.firestore
      .collection('player_match_stats')
      .where('season', '==', params.season)
      .where('round_number', '==', round)
      .get();

    for (const doc of snapshot.docs) {
      const playerId = resolveCanonicalPlayerIdFromRecord(
        doc.data() as Record<string, unknown>,
        playerIdentityResolver
      );
      if (playerId) {
        playerIds.add(playerId);
      }
    }
  }

  return [...playerIds];
}

async function loadPersistedPlayerSeasonSummaries(
  prismaClient: PrismaReadWriteClient,
  season: number
): Promise<PlayerSeasonSummaryRow[]> {
  const rows = await prismaClient.playerSeasonSummary.findMany({
    where: { season },
  });

  return rows.map((row) => ({
    id: row.id,
    playerId: row.playerId,
    season: row.season,
    playerName: row.playerName,
    club: row.club,
    position: row.position,
    gamesPlayed: row.gamesPlayed,
    averageScore: row.averageScore,
    totalValue: row.totalValue,
    stats: parseStatsJson(row.statsJson),
    totals: parseStatsJson(row.totalsJson),
    sourceUpdatedAt: row.sourceUpdatedAt,
  }));
}

async function countPublishedRankingSnapshots(params: {
  prismaClient: PrismaReadWriteClient;
  season: number;
  scope: string;
}): Promise<number> {
  return params.prismaClient.playerRankingSnapshot.count({
    where: {
      season: params.season,
      scope: params.scope,
      method: PLAYER_RANKING_METHOD,
      methodVersion: PLAYER_RANKING_METHOD_VERSION,
    },
  });
}

async function countPublishedRosterSummaries(params: {
  prismaClient: PrismaReadWriteClient;
  season: number;
}): Promise<number> {
  return params.prismaClient.leagueRosterPlayerSummary.count({
    where: { season: params.season },
  });
}

async function loadExistingPublicationState(params: {
  prismaClient: PrismaReadWriteClient;
  season: number;
  scope: string;
}) {
  return params.prismaClient.playerProjectionPublication.findUnique({
    where: {
      id: `${params.season}:${params.scope}`,
    },
    select: {
      rankingCount: true,
      rosterCount: true,
      rankingsDirty: true,
      rostersDirty: true,
      rankingPublishedAt: true,
      rosterPublishedAt: true,
    },
  });
}

export async function buildLeagueRosterPlayerSummaries(params: {
  season: number;
  prismaClient?: PrismaReadWriteClient;
  leagueId?: string;
}): Promise<LeagueRosterPlayerSummaryRow[]> {
  const prismaClient = params.prismaClient ?? prisma;
  const [rosterPlayers, rosterConfigs, seasonSummaries] = await Promise.all([
    prismaClient.leagueRosterPlayer.findMany({
      where: params.leagueId ? { leagueId: params.leagueId } : undefined,
      include: {
        player: { select: { id: true, name: true, club: true, position: true } },
      },
      orderBy: [{ leagueId: 'asc' }, { memberId: 'asc' }, { sortOrder: 'asc' }],
    }),
    prismaClient.leagueRoster.findMany({
      where: params.leagueId ? { leagueId: params.leagueId } : undefined,
      select: { leagueId: true, memberId: true, captainId: true, viceCaptainId: true },
    }),
    prismaClient.playerSeasonSummary.findMany({
      where: { season: params.season },
    }),
  ]);

  const rosterConfigByMember = new Map(
    rosterConfigs.map((row) => [`${row.leagueId}:${row.memberId}`, row] as const)
  );
  const seasonSummaryByPlayerId = new Map<
    string,
    {
      stats: Record<CanonicalStatKey, number>;
      totals: Record<CanonicalStatKey, number>;
      gamesPlayed: number;
      averageScore: number;
      totalValue: number;
      club: string;
      position: string;
      playerName: string;
    }
  >(
    seasonSummaries.map(
      (row) =>
        [
          row.playerId,
          {
            stats: parseStatsJson(row.statsJson),
            totals: parseStatsJson(row.totalsJson),
            gamesPlayed: row.gamesPlayed,
            averageScore: row.averageScore,
            totalValue: row.totalValue,
            club: row.club,
            position: row.position,
            playerName: row.playerName,
          },
        ] as const
    )
  );

  const ownershipCounts = new Map<string, Map<string, number>>();
  const teamMembersByLeague = new Map<string, Set<string>>();
  for (const row of rosterPlayers) {
    const byLeague = ownershipCounts.get(row.leagueId) ?? new Map<string, number>();
    byLeague.set(row.playerId, (byLeague.get(row.playerId) ?? 0) + 1);
    ownershipCounts.set(row.leagueId, byLeague);
    const leagueMembers = teamMembersByLeague.get(row.leagueId) ?? new Set<string>();
    leagueMembers.add(row.memberId);
    teamMembersByLeague.set(row.leagueId, leagueMembers);
  }

  return rosterPlayers.map((row) => {
    const rosterConfig = rosterConfigByMember.get(`${row.leagueId}:${row.memberId}`);
    const seasonSummary = seasonSummaryByPlayerId.get(row.playerId);
    const stats = seasonSummary?.stats ?? buildEmptyStats();
    const totals = seasonSummary?.totals ?? buildEmptyStats();
    const averageScore = seasonSummary?.averageScore ?? 0;
    const totalValue = seasonSummary?.totalValue ?? 0;
    const leagueOwnership = ownershipCounts.get(row.leagueId);
    const totalTeams = teamMembersByLeague.get(row.leagueId)?.size ?? 0;
    const ownedCount = leagueOwnership?.get(row.playerId) ?? 0;
    const ownership = totalTeams > 0 ? Math.round((ownedCount / totalTeams) * 100) : 0;

    return {
      id: `${row.leagueId}:${row.memberId}:${row.playerId}:${params.season}`,
      leagueId: row.leagueId,
      memberId: row.memberId,
      playerId: row.playerId,
      season: params.season,
      sortOrder: row.sortOrder,
      playerName: seasonSummary?.playerName ?? row.player.name,
      club: seasonSummary?.club ?? row.player.club,
      position: seasonSummary?.position ?? row.player.position,
      ownership,
      isCaptain: rosterConfig?.captainId === row.playerId,
      isViceCaptain: rosterConfig?.viceCaptainId === row.playerId,
      gamesPlayed: seasonSummary?.gamesPlayed ?? 0,
      averageScore,
      totalValue,
      price: 0,
      lastGameScore: 0,
      projectedScore: 0,
      form: [],
      stats,
      totals,
    };
  });
}

export async function persistLeagueRosterPlayerSummaries(
  prismaClient: PrismaReadWriteClient,
  season: number,
  rows: LeagueRosterPlayerSummaryRow[],
  leagueId?: string
): Promise<void> {
  await prismaClient.leagueRosterPlayerSummary.deleteMany({
    where: leagueId ? { season, leagueId } : { season },
  });

  if (rows.length === 0) return;

  for (let index = 0; index < rows.length; index += 250) {
    const chunk = rows.slice(index, index + 250);
    await prismaClient.leagueRosterPlayerSummary.createMany({
      data: chunk.map((row) => ({
        id: row.id,
        leagueId: row.leagueId,
        memberId: row.memberId,
        playerId: row.playerId,
        season: row.season,
        sortOrder: row.sortOrder,
        playerName: row.playerName,
        club: row.club,
        position: row.position,
        ownership: row.ownership,
        isCaptain: row.isCaptain,
        isViceCaptain: row.isViceCaptain,
        gamesPlayed: row.gamesPlayed,
        averageScore: row.averageScore,
        totalValue: row.totalValue,
        price: row.price,
        lastGameScore: row.lastGameScore,
        projectedScore: row.projectedScore,
        formJson: JSON.stringify(row.form),
        statsJson: serializeStats(row.stats),
        totalsJson: serializeStats(row.totals),
      })),
    });
  }
}

async function persistPlayerProjectionPublication(params: {
  prismaClient: PrismaReadWriteClient;
  season: number;
  scope: string;
  summaryCount: number;
  rankingCount: number;
  rosterCount: number;
  integrity: Pick<AdvancedStatIntegrity, 'degradedStats'>;
  rankingsDirty: boolean;
  rostersDirty: boolean;
  rankingPublishedAt?: Date | null;
  rosterPublishedAt?: Date | null;
}): Promise<boolean> {
  const isReady =
    params.summaryCount > 0 &&
    params.rankingCount > 0 &&
    params.rosterCount >= 0 &&
    !params.rankingsDirty &&
    !params.rostersDirty &&
    params.integrity.degradedStats.length === 0;

  await params.prismaClient.playerProjectionPublication.upsert({
    where: {
      id: `${params.season}:${params.scope}`,
    },
    update: {
      summaryCount: params.summaryCount,
      rankingCount: params.rankingCount,
      rosterCount: params.rosterCount,
      rankingMethod: PLAYER_RANKING_METHOD,
      rankingMethodVersion: PLAYER_RANKING_METHOD_VERSION,
      rankingMinimumGames: PLAYER_RANKING_MIN_GAMES,
      rankingPopulationSize: params.rankingCount,
      rankingsDirty: params.rankingsDirty,
      rankingPublishedAt: params.rankingPublishedAt ?? undefined,
      rankingMetadataJson: JSON.stringify({
        integrityDegradedStats: params.integrity.degradedStats,
      }),
      rostersDirty: params.rostersDirty,
      rosterPublishedAt: params.rosterPublishedAt ?? undefined,
      publishedAt: new Date(),
    },
    create: {
      id: `${params.season}:${params.scope}`,
      season: params.season,
      scope: params.scope,
      summaryCount: params.summaryCount,
      rankingCount: params.rankingCount,
      rosterCount: params.rosterCount,
      rankingMethod: PLAYER_RANKING_METHOD,
      rankingMethodVersion: PLAYER_RANKING_METHOD_VERSION,
      rankingMinimumGames: PLAYER_RANKING_MIN_GAMES,
      rankingPopulationSize: params.rankingCount,
      rankingsDirty: params.rankingsDirty,
      rankingPublishedAt: params.rankingPublishedAt ?? undefined,
      rankingMetadataJson: JSON.stringify({
        integrityDegradedStats: params.integrity.degradedStats,
      }),
      rostersDirty: params.rostersDirty,
      rosterPublishedAt: params.rosterPublishedAt ?? undefined,
      publishedAt: new Date(),
    },
  });

  return isReady;
}

export async function publishPlayerRankings(params?: {
  season?: number;
  scope?: string;
  prismaClient?: PrismaDb;
}): Promise<{
  season: number;
  scope: string;
  rankingSnapshots: number;
  rankingPublishedAt: Date;
  published: boolean;
  degradedAdvancedStats: CanonicalStatKey[];
}> {
  const season = params?.season ?? getDefaultAflSeason();
  const scope = params?.scope ?? 'season';
  const prismaClient = params?.prismaClient ?? prisma;

  const [persistedSummaries, publicationState] = await Promise.all([
    loadPersistedPlayerSeasonSummaries(prismaClient, season),
    loadExistingPublicationState({ prismaClient, season, scope }),
  ]);
  const integrity = getAdvancedStatIntegrityFromSummaries(persistedSummaries);
  const rankingPublishedAt = new Date();
  const rankingSnapshots = buildPlayerRankingSnapshots(season, persistedSummaries, scope, rankingPublishedAt);
  await persistPlayerRankingSnapshots(prismaClient, season, rankingSnapshots, scope);

  const published = await persistPlayerProjectionPublication({
    prismaClient,
    season,
    scope,
    summaryCount: persistedSummaries.length,
    rankingCount: rankingSnapshots.length,
    rosterCount: publicationState?.rosterCount ?? (await countPublishedRosterSummaries({ prismaClient, season })),
    integrity,
    rankingsDirty: false,
    rostersDirty: publicationState?.rostersDirty ?? false,
    rankingPublishedAt,
    rosterPublishedAt: publicationState?.rosterPublishedAt ?? null,
  });

  logger.info('player rankings published', {
    season,
    scope,
    rankingSnapshots: rankingSnapshots.length,
    rankingPublishedAt,
    published,
    degradedAdvancedStats: integrity.degradedStats,
  });

  return {
    season,
    scope,
    rankingSnapshots: rankingSnapshots.length,
    rankingPublishedAt,
    published,
    degradedAdvancedStats: integrity.degradedStats,
  };
}

export async function publishLeagueRosterSummaries(params?: {
  season?: number;
  scope?: string;
  prismaClient?: PrismaDb;
  leagueId?: string;
}): Promise<{
  season: number;
  scope: string;
  leagueId?: string;
  rosterSummaries: number;
  rosterPublishedAt: Date;
  published: boolean;
  degradedAdvancedStats: CanonicalStatKey[];
  rostersDirty: boolean;
}> {
  const season = params?.season ?? getDefaultAflSeason();
  const scope = params?.scope ?? 'season';
  const prismaClient = params?.prismaClient ?? prisma;

  const [persistedSummaries, publicationState] = await Promise.all([
    loadPersistedPlayerSeasonSummaries(prismaClient, season),
    loadExistingPublicationState({ prismaClient, season, scope }),
  ]);
  const integrity = getAdvancedStatIntegrityFromSummaries(persistedSummaries);
  const rosterRows = await buildLeagueRosterPlayerSummaries({
    season,
    prismaClient,
    leagueId: params?.leagueId,
  });
  await persistLeagueRosterPlayerSummaries(prismaClient, season, rosterRows, params?.leagueId);

  const rosterPublishedAt = new Date();
  const rostersDirty = Boolean(params?.leagueId);
  const rosterCount = await countPublishedRosterSummaries({ prismaClient, season });
  const published = await persistPlayerProjectionPublication({
    prismaClient,
    season,
    scope,
    summaryCount: persistedSummaries.length,
    rankingCount:
      publicationState?.rankingCount ??
      (await countPublishedRankingSnapshots({ prismaClient, season, scope })),
    rosterCount,
    integrity,
    rankingsDirty: publicationState?.rankingsDirty ?? false,
    rostersDirty,
    rankingPublishedAt: publicationState?.rankingPublishedAt ?? null,
    rosterPublishedAt,
  });

  logger.info('league roster summaries published', {
    season,
    scope,
    leagueId: params?.leagueId,
    rosterSummaries: rosterRows.length,
    rosterCount,
    rosterPublishedAt,
    published,
    rostersDirty,
    degradedAdvancedStats: integrity.degradedStats,
  });

  return {
    season,
    scope,
    leagueId: params?.leagueId,
    rosterSummaries: rosterRows.length,
    rosterPublishedAt,
    published,
    degradedAdvancedStats: integrity.degradedStats,
    rostersDirty,
  };
}

export async function refreshPlayerReadModels(params?: {
  season?: number;
  scope?: string;
  prismaClient?: PrismaDb;
  firestore?: FirestoreLike;
  leagueId?: string;
  rounds?: number[];
  playerIds?: string[];
}): Promise<{
  season: number;
  playerSeasonSummaries: number;
  rankingSnapshots: number;
  rosterSummaries: number;
  skippedWithoutCanonicalId: number;
  fallbackResolvedPlayerProfiles: number;
  skippedWithoutResolvedPlayerProfile: number;
  published: boolean;
  rankingsDirty: boolean;
  rostersDirty: boolean;
  degradedAdvancedStats: CanonicalStatKey[];
  refreshedPlayerIds: number;
  refreshedRounds: number[];
}> {
  const season = params?.season ?? getDefaultAflSeason();
  const scope = params?.scope ?? 'season';
  const prismaClient = params?.prismaClient ?? prisma;
  const firestore = params?.firestore ?? adminDb;
  const refreshedRounds = [...new Set(params?.rounds ?? [])].sort((a, b) => a - b);
  const scopedPlayerIds =
    params?.playerIds && params.playerIds.length > 0
      ? [...new Set(params.playerIds)]
      : refreshedRounds.length > 0
        ? await listCanonicalPlayerIdsForRounds({ season, rounds: refreshedRounds, firestore, prismaClient })
        : undefined;

  const {
    summaries,
    recentFormSummaries,
    latestSnapshots,
    matchLogProjections,
    skippedWithoutCanonicalId,
    fallbackResolvedPlayerProfiles,
    skippedWithoutResolvedPlayerProfile,
    integrity,
  } =
    await buildPlayerSeasonSummaries({
      season,
      firestore,
      prismaClient,
      playerIds: scopedPlayerIds,
    });

  await prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
    await persistPlayerSeasonSummaries(tx, season, summaries, scopedPlayerIds);
    await persistPlayerRecentFormSummaries(tx, season, recentFormSummaries, scopedPlayerIds);
    await persistPlayerLatestSnapshots(tx, season, latestSnapshots, scopedPlayerIds);
    await persistPlayerMatchLogProjections(
      tx,
      season,
      matchLogProjections,
      scopedPlayerIds,
      refreshedRounds
    );
  });

  const persistedSummaries = await loadPersistedPlayerSeasonSummaries(prismaClient, season);
  const publicationState = await loadExistingPublicationState({ prismaClient, season, scope });
  const rankingsDirty = true;
  const rostersDirty = true;
  const rankingCount =
    publicationState?.rankingCount ??
    (await countPublishedRankingSnapshots({ prismaClient, season, scope }));
  const rosterCount =
    publicationState?.rosterCount ?? (await countPublishedRosterSummaries({ prismaClient, season }));
  const published = await persistPlayerProjectionPublication({
    prismaClient,
    season,
    scope,
    summaryCount: persistedSummaries.length,
    rankingCount,
    rosterCount,
    integrity,
    rankingsDirty,
    rostersDirty,
    rankingPublishedAt: publicationState?.rankingPublishedAt ?? null,
    rosterPublishedAt: publicationState?.rosterPublishedAt ?? null,
  });

  logger.info('player read models refreshed', {
    season,
    scope,
    playerSeasonSummaries: summaries.length,
    playerRecentFormSummaries: recentFormSummaries.length,
    playerLatestSnapshots: latestSnapshots.length,
    playerMatchLogProjections: matchLogProjections.length,
    rankingSnapshots: rankingCount,
    rosterSummaries: rosterCount,
    published,
    rankingsDirty,
    rostersDirty,
    skippedWithoutCanonicalId,
    fallbackResolvedPlayerProfiles,
    skippedWithoutResolvedPlayerProfile,
    degradedAdvancedStats: integrity.degradedStats,
    refreshedPlayerIds: scopedPlayerIds?.length ?? summaries.length,
    refreshedRounds,
  });

  return {
    season,
    playerSeasonSummaries: summaries.length,
    rankingSnapshots: rankingCount,
    rosterSummaries: rosterCount,
    skippedWithoutCanonicalId,
    fallbackResolvedPlayerProfiles,
    skippedWithoutResolvedPlayerProfile,
    published,
    rankingsDirty,
    rostersDirty,
    degradedAdvancedStats: integrity.degradedStats,
    refreshedPlayerIds: scopedPlayerIds?.length ?? summaries.length,
    refreshedRounds,
  };
}

const seasonSummaryMaterialization = new Map<number, Promise<void>>();
/** Seasons where a refresh completed but left zero rows (no Firestore match data); avoid hammering. */
const seasonSummaryMaterializationDeadletter = new Set<number>();

/**
 * Ensures `PlayerSeasonSummary` exists for a season by running the same Firestore → Prisma pipeline
 * as admin/cron (`refreshPlayerReadModels`). Deduplicated per season for concurrent requests.
 *
 * - **Non-production** (`NODE_ENV` not `production`): runs automatically when the table is empty.
 * - **Production**: only when `STATLY_ALLOW_READ_MODEL_ON_DEMAND=true` (e.g. staging self-heal).
 * - **Tests / emergency skip**: `STATLY_DISABLE_READ_MODEL_AUTO_REFRESH=1`.
 */
export async function ensurePlayerSeasonSummariesMaterialized(
  prismaClient: PrismaDb,
  season: number
): Promise<void> {
  if (process.env.STATLY_DISABLE_READ_MODEL_AUTO_REFRESH === '1') return;

  const allowOnDemand =
    process.env.NODE_ENV !== 'production' ||
    process.env.STATLY_ALLOW_READ_MODEL_ON_DEMAND === 'true';
  if (!allowOnDemand) return;

  if (seasonSummaryMaterializationDeadletter.has(season)) return;

  const inflight = seasonSummaryMaterialization.get(season);
  if (inflight) {
    await inflight;
    return;
  }

  const job = (async () => {
    try {
      const [summaryCount, publication] = await Promise.all([
        prismaClient.playerSeasonSummary.count({ where: { season } }),
        prismaClient.playerProjectionPublication.findFirst({
          where: { season, scope: 'season' },
          select: { id: true },
        }),
      ]);
      if (summaryCount > 0 && publication) return;

      logger.info('PlayerSeasonSummary missing or unpublished for season; materializing from Firestore', {
        season,
        summaryCount,
        hasPublication: Boolean(publication),
      });
      await refreshPlayerReadModels({ season, prismaClient });
      const [after, publishedAfter] = await Promise.all([
        prismaClient.playerSeasonSummary.count({ where: { season } }),
        prismaClient.playerProjectionPublication.findFirst({
          where: { season, scope: 'season' },
          select: { id: true },
        }),
      ]);
      if (after === 0 || !publishedAfter) {
        seasonSummaryMaterializationDeadletter.add(season);
        logger.warn(
          'PlayerSeasonSummary still incomplete after refresh; skipping further on-demand attempts this process',
          { season, summaryCountAfter: after, publishedAfter: Boolean(publishedAfter) }
        );
      }
    } catch (error) {
      logger.error('On-demand player read model materialization failed', { season, error });
    }
  })();

  seasonSummaryMaterialization.set(season, job);
  job.finally(() => {
    if (seasonSummaryMaterialization.get(season) === job) {
      seasonSummaryMaterialization.delete(season);
    }
  });

  await job;
}

export async function getPlayerSeasonSummaryMap(
  prismaClient: PrismaReadWriteClient,
  season: number,
  playerIds: string[]
): Promise<
  Map<
    string,
    {
      gamesPlayed: number;
      averageScore: number;
      totalValue: number;
      stats: Record<CanonicalStatKey, number>;
      totals: Record<CanonicalStatKey, number>;
      club: string;
      position: string;
      playerName: string;
    }
  >
> {
  if (playerIds.length === 0) return new Map();
  const rows = await prismaClient.playerSeasonSummary.findMany({
    where: { season, playerId: { in: playerIds } },
  });
  return new Map(
    rows.map(
      (row) =>
        [
          row.playerId,
          {
            gamesPlayed: row.gamesPlayed,
            averageScore: row.averageScore,
            totalValue: row.totalValue,
            stats: parseStatsJson(row.statsJson),
            totals: parseStatsJson(row.totalsJson),
            club: row.club,
            position: row.position,
            playerName: row.playerName,
          },
        ] as const
    )
  );
}

export async function listRawMatchLogStageRows(params: {
  season: number;
  rounds?: number[];
  playerId?: string;
}): Promise<MatchLogReconciliationStageRow[]> {
  const { playerMap, playerIdentityResolver } = await loadAllPlayersMap(prisma);
  const requestedRounds = [...new Set(params.rounds ?? [])].sort((a, b) => a - b);
  const docs =
    requestedRounds.length > 0
      ? (
          await Promise.all(
            requestedRounds.map((round) =>
              adminDb
                .collection('player_match_stats')
                .where('season', '==', params.season)
                .where('round_number', '==', round)
                .get()
            )
          )
        ).flatMap((snapshot) => snapshot.docs)
      : (await adminDb.collection('player_match_stats').where('season', '==', params.season).get()).docs;
  const { rows: selectedRows } = await selectBestCanonicalRawRows({
    docs,
    season: params.season,
    firestore: adminDb,
    playerMap,
    playerIdentityResolver,
    playerId: params.playerId,
  });
  const requestedRoundSet = new Set(requestedRounds);
  const scopedRows =
    requestedRoundSet.size > 0
      ? selectedRows.filter((row) => row.roundNumber != null && requestedRoundSet.has(row.roundNumber))
      : selectedRows;
  const rows: MatchLogReconciliationStageRow[] = [];

  for (const row of scopedRows) {
    const {
      data,
      playerId,
      storagePlayerId,
      matchId,
      storageMatchId,
      playerName,
      roundNumber,
      opponent,
      season,
      updatedAt,
    } = row;
    const resolvedRoundNumber = roundNumber ?? 0;
    rows.push({
      entityKey: buildMatchLogEntityKey({
        season,
        roundNumber: resolvedRoundNumber,
        playerId,
        matchId,
        playerName,
        opponent,
      }),
      matchId,
      storageMatchId,
      season,
      roundNumber: resolvedRoundNumber,
      playerId,
      storagePlayerId,
      playerName,
      opponent,
      stage: buildMatchLogStageSnapshot(buildStageStatsFromRawData(data), {
        availability: buildStageAvailabilityFromRawData(data),
        provenance: buildStageProvenanceFromRawData(data),
      }),
      sourceUpdatedAt: updatedAt,
    });
  }

  return rows;
}

export async function listProjectedMatchLogStageRows(params: {
  prismaClient?: PrismaReadWriteClient;
  season: number;
  playerId?: string;
}): Promise<MatchLogReconciliationStageRow[]> {
  const prismaClient = params.prismaClient ?? prisma;
  const rows = await prismaClient.playerMatchLogProjection.findMany({
    where: {
      season: params.season,
      playerId: params.playerId,
    },
    include: {
      player: {
        select: {
          name: true,
        },
      },
    },
  });

  return rows.map((row) => {
    const parsed = parseMatchLogStatsPayload(row.statsJson);
    return {
      entityKey: buildMatchLogEntityKey({
        season: row.season,
        roundNumber: row.roundNumber,
        playerId: row.playerId,
        matchId: row.matchId,
        playerName: row.player.name,
        opponent: row.opponent,
      }),
      matchId: row.matchId,
      season: row.season,
      roundNumber: row.roundNumber,
      playerId: row.playerId,
      playerName: row.player.name,
      opponent: row.opponent,
      stage: buildMatchLogStageSnapshot(parsed.stats, {
        availability: parsed.availability,
      }),
      sourceUpdatedAt: row.sourceUpdatedAt,
    };
  });
}

export async function listSeasonSummaryReconciliationRows(params: {
  prismaClient?: PrismaReadWriteClient;
  season: number;
  playerId?: string;
}): Promise<SeasonSummaryReconciliationRow[]> {
  const prismaClient = params.prismaClient ?? prisma;
  const rows = await prismaClient.playerSeasonSummary.findMany({
    where: {
      season: params.season,
      playerId: params.playerId,
    },
    orderBy: [{ totalValue: 'desc' }, { playerName: 'asc' }],
  });

  return rows.map((row) => ({
    playerId: row.playerId,
    playerName: row.playerName,
    season: row.season,
    gamesPlayed: row.gamesPlayed,
    stats: parseStatsJson(row.statsJson),
    totals: parseStatsJson(row.totalsJson),
    sourceUpdatedAt: row.sourceUpdatedAt,
  }));
}

export async function resolveLatestProjectedSeason(
  prismaClient: PrismaReadWriteClient,
  fallbackSeason = getDefaultAflSeason()
): Promise<number> {
  const publishedSeason = await prismaClient.playerProjectionPublication.findFirst({
    where: {
      scope: 'season',
      summaryCount: { gt: 0 },
      rankingCount: { gt: 0 },
      rankingMethod: PLAYER_RANKING_METHOD,
      rankingMethodVersion: PLAYER_RANKING_METHOD_VERSION,
      rankingsDirty: false,
    },
    orderBy: [{ season: 'desc' }, { publishedAt: 'desc' }],
    select: { season: true },
  });
  if (publishedSeason) return publishedSeason.season;

  const candidateSeasons = Array.from(
    new Set([fallbackSeason + 1, fallbackSeason, fallbackSeason - 1, fallbackSeason - 2])
  ).filter((season) => season >= 2020);

  for (const season of candidateSeasons) {
    const [rankingCount, summaryCount] = await Promise.all([
      prismaClient.playerRankingSnapshot.count({
        where: {
          season,
          scope: 'season',
          method: PLAYER_RANKING_METHOD,
          methodVersion: PLAYER_RANKING_METHOD_VERSION,
        },
      }),
      prismaClient.playerSeasonSummary.count({ where: { season } }),
    ]);

    if (rankingCount > 0 && summaryCount > 0) {
      const rows = await prismaClient.playerSeasonSummary.findMany({
        where: { season },
        select: { statsJson: true, totalsJson: true },
      });
      const integrity = getAdvancedStatIntegrityFromSummaries(
        rows.map((row) => ({
          stats: parseStatsJson(row.statsJson),
          totals: parseStatsJson(row.totalsJson),
        }))
      );
      if (integrity.degradedStats.length === 0) {
        return season;
      }
    }
  }

  const latestSummary = await prismaClient.playerSeasonSummary.findFirst({
    orderBy: [{ season: 'desc' }, { updatedAt: 'desc' }],
    select: { season: true },
  });
  if (latestSummary) return latestSummary.season;

  const latestRanking = await prismaClient.playerRankingSnapshot.findFirst({
    where: {
      scope: 'season',
      method: PLAYER_RANKING_METHOD,
      methodVersion: PLAYER_RANKING_METHOD_VERSION,
    },
    orderBy: [{ season: 'desc' }, { snapshotAt: 'desc' }],
    select: { season: true },
  });
  return latestRanking?.season ?? fallbackSeason;
}

export async function listPlayerRankingSnapshots(params: {
  prismaClient?: PrismaReadWriteClient;
  season: number;
  scope?: string;
  limit?: number | null;
  method?: string;
  methodVersion?: number;
}): Promise<PlayerRankingSnapshotRow[]> {
  const prismaClient = params.prismaClient ?? prisma;
  const rows = await prismaClient.playerRankingSnapshot.findMany({
    where: {
      season: params.season,
      scope: params.scope ?? 'season',
      method: params.method ?? PLAYER_RANKING_METHOD,
      methodVersion: params.methodVersion ?? PLAYER_RANKING_METHOD_VERSION,
    },
    orderBy: { rank: 'asc' },
    take: params.limit ?? undefined,
  });

  return rows.map((row) => ({
    id: row.id,
    season: row.season,
    scope: row.scope,
    method: row.method,
    methodVersion: row.methodVersion,
    rank: row.rank,
    playerId: row.playerId,
    playerName: row.playerName,
    club: row.club,
    position: row.position,
    gamesPlayed: row.gamesPlayed,
    averageScore: row.averageScore,
    totalValue: row.totalValue,
    rankingValue: row.rankingValue,
    minimumGames: row.minimumGames,
    populationSize: row.populationSize,
    isSmallSample: row.isSmallSample,
    categories: JSON.parse(row.categoriesJson) as Record<string, number>,
    stats: parseStatsJson(row.statsJson),
    totals: parseStatsJson(row.totalsJson),
    metadata: row.metadataJson ? (JSON.parse(row.metadataJson) as Record<string, unknown>) : null,
    snapshotAt: row.snapshotAt,
  }));
}

function rosterTotalsHaveAnyNonZero(totals: Record<CanonicalStatKey, number>): boolean {
  for (const key of CANONICAL_STAT_KEYS) {
    if ((totals[key] ?? 0) !== 0) return true;
  }
  return false;
}

function needsPlayerSeasonSummaryHydration(
  summary:
    | {
        gamesPlayed: number;
        totals: Record<CanonicalStatKey, number>;
      }
    | undefined
): boolean {
  if (!summary) return true;
  return summary.gamesPlayed === 0 && !rosterTotalsHaveAnyNonZero(summary.totals);
}

type LeagueRosterSummaryMap = Map<
  string,
  {
    playerId: string;
    playerName: string;
    club: string;
    position: string;
    ownership: number;
    isCaptain: boolean;
    isViceCaptain: boolean;
    gamesPlayed: number;
    averageScore: number;
    totalValue: number;
    price: number;
    lastGameScore: number;
    projectedScore: number;
    form: number[];
    stats: Record<CanonicalStatKey, number>;
    totals: Record<CanonicalStatKey, number>;
    sortOrder: number;
  }
>;

/**
 * When `LeagueRosterPlayerSummary` was never materialized or is all-zero, overlay stats from
 * `PlayerSeasonSummary` (ETL source of truth). Keeps ownership/price/form from materialized rows when present.
 */
async function hydrateLeagueRosterMapFromPlayerSeasonSummaries(
  prismaClient: PrismaReadWriteClient,
  aggregated: LeagueRosterSummaryMap,
  options: {
    playerIds: string[];
    seasons: number[];
    rosterCaptainId?: string | null;
    rosterViceCaptainId?: string | null;
  }
): Promise<void> {
  const pending = new Set(
    options.playerIds.filter((id) => needsPlayerSeasonSummaryHydration(aggregated.get(id)))
  );
  if (pending.size === 0) return;

  for (const season of options.seasons) {
    if (pending.size === 0) break;
    const seasonMap = await getPlayerSeasonSummaryMap(prismaClient, season, [...pending]);
    for (const playerId of pending) {
      const sm = seasonMap.get(playerId);
      if (!sm) continue;
      if (sm.gamesPlayed === 0 && !rosterTotalsHaveAnyNonZero(sm.totals)) continue;

      const existing = aggregated.get(playerId);
      aggregated.set(playerId, {
        playerId,
        playerName: sm.playerName,
        club: sm.club,
        position: sm.position,
        ownership: existing?.ownership ?? 0,
        isCaptain: existing?.isCaptain ?? options.rosterCaptainId === playerId,
        isViceCaptain: existing?.isViceCaptain ?? options.rosterViceCaptainId === playerId,
        gamesPlayed: sm.gamesPlayed,
        averageScore: sm.averageScore,
        totalValue: sm.totalValue,
        price: existing?.price ?? 0,
        lastGameScore: existing?.lastGameScore ?? 0,
        projectedScore: existing?.projectedScore ?? 0,
        form: existing?.form ?? [],
        stats: sm.stats,
        totals: sm.totals,
        sortOrder: existing?.sortOrder ?? 0,
      });
      pending.delete(playerId);
    }
  }
}

export async function getLeagueRosterSummaryMap(params: {
  prismaClient?: PrismaReadWriteClient;
  leagueId: string;
  memberId: string;
  seasons: number[];
  /**
   * For these roster player IDs, when materialized `LeagueRosterPlayerSummary` is missing or has no usable
   * stat totals, merge rows from `PlayerSeasonSummary` (same seasons list, first match wins).
   */
  hydrateStatsFromSeasonSummaryForPlayerIds?: string[];
  rosterCaptainId?: string | null;
  rosterViceCaptainId?: string | null;
}): Promise<
  Map<
    string,
    {
      playerId: string;
      playerName: string;
      club: string;
      position: string;
      ownership: number;
      isCaptain: boolean;
      isViceCaptain: boolean;
      gamesPlayed: number;
      averageScore: number;
      totalValue: number;
      price: number;
      lastGameScore: number;
      projectedScore: number;
      form: number[];
      stats: Record<CanonicalStatKey, number>;
      totals: Record<CanonicalStatKey, number>;
      sortOrder: number;
    }
  >
> {
  const prismaClient = params.prismaClient ?? prisma;
  if (params.seasons.length === 0) return new Map();

  const rows = await prismaClient.leagueRosterPlayerSummary.findMany({
    where: {
      leagueId: params.leagueId,
      memberId: params.memberId,
      season: { in: params.seasons },
    },
    orderBy: [{ sortOrder: 'asc' }, { season: 'asc' }],
  });

  const aggregated = new Map<
    string,
    {
      playerId: string;
      playerName: string;
      club: string;
      position: string;
      ownership: number;
      isCaptain: boolean;
      isViceCaptain: boolean;
      gamesPlayed: number;
      averageScore: number;
      totalValue: number;
      price: number;
      lastGameScore: number;
      projectedScore: number;
      form: number[];
      stats: Record<CanonicalStatKey, number>;
      totals: Record<CanonicalStatKey, number>;
      sortOrder: number;
    }
  >();

  for (const row of rows) {
    const existing = aggregated.get(row.playerId) ?? {
      playerId: row.playerId,
      playerName: row.playerName,
      club: row.club,
      position: row.position,
      ownership: row.ownership,
      isCaptain: row.isCaptain,
      isViceCaptain: row.isViceCaptain,
      gamesPlayed: 0,
      averageScore: 0,
      totalValue: 0,
      price: row.price,
      lastGameScore: row.lastGameScore,
      projectedScore: row.projectedScore,
      form: parseNumberArrayJson(row.formJson),
      stats: buildEmptyStats(),
      totals: buildEmptyStats(),
      sortOrder: row.sortOrder,
    };

    const rowTotals = parseStatsJson(row.totalsJson);
    addInto(existing.totals, rowTotals);
    existing.gamesPlayed += row.gamesPlayed;
    existing.totalValue += row.totalValue;
    existing.ownership = row.ownership;
    existing.isCaptain = row.isCaptain;
    existing.isViceCaptain = row.isViceCaptain;
    existing.sortOrder = Math.min(existing.sortOrder, row.sortOrder);
    aggregated.set(row.playerId, existing);
  }

  for (const value of aggregated.values()) {
    value.stats = divideStats(value.totals, value.gamesPlayed);
    value.averageScore = value.gamesPlayed > 0 ? value.totalValue / value.gamesPlayed : 0;
  }

  if (params.hydrateStatsFromSeasonSummaryForPlayerIds?.length) {
    await hydrateLeagueRosterMapFromPlayerSeasonSummaries(prismaClient, aggregated, {
      playerIds: params.hydrateStatsFromSeasonSummaryForPlayerIds,
      seasons: params.seasons,
      rosterCaptainId: params.rosterCaptainId,
      rosterViceCaptainId: params.rosterViceCaptainId,
    });
  }

  return aggregated;
}
