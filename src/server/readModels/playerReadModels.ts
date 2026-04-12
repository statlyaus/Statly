import type { Prisma, PrismaClient } from '@prisma/client';

import { getDefaultAflSeason } from '@/lib/aflSeason';
import { adminDb } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { readCanonicalMatchKey, readCanonicalPlayerId } from '@/lib/playerMatchStats';
import { prisma } from '@/lib/prisma';
import { CANONICAL_STAT_KEYS, type CanonicalStatKey } from '@/lib/stats/statColumns';
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

export type PlayerRankingSnapshotRow = {
  id: string;
  season: number;
  scope: string;
  rank: number;
  playerId: string;
  playerName: string;
  club: string;
  position: string;
  gamesPlayed: number;
  averageScore: number;
  totalValue: number;
  categories: Record<string, number>;
  stats: Record<CanonicalStatKey, number>;
  totals: Record<CanonicalStatKey, number>;
  snapshotAt: Date;
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

function buildEmptyStats(): Record<CanonicalStatKey, number> {
  const empty = {} as Record<CanonicalStatKey, number>;
  for (const key of CANONICAL_STAT_KEYS) {
    empty[key] = 0;
  }
  return empty;
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

function readStat(data: Record<string, unknown>, key: string, altKeys: string[] = []): number {
  const stats = (data.stats as Record<string, unknown> | undefined) ?? {};
  const raw = (data.raw_row as Record<string, unknown> | undefined) ?? {};

  for (const candidate of [key, ...altKeys]) {
    const value = data[candidate] ?? stats[candidate] ?? raw[candidate];
    const numberValue = readNumber(value);
    if (numberValue !== 0) return numberValue;
  }

  return 0;
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

function serializeStats(stats: Record<CanonicalStatKey, number>): string {
  return JSON.stringify(stats);
}

function parseStatsJson(raw: string | null | undefined): Record<CanonicalStatKey, number> {
  if (!raw) return buildEmptyStats();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const stats = buildEmptyStats();
    for (const key of CANONICAL_STAT_KEYS) {
      stats[key] = readNumber(parsed[key]);
    }
    return stats;
  } catch {
    return buildEmptyStats();
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
  };
}

export async function buildPlayerSeasonSummaries(params: {
  season: number;
  firestore?: FirestoreLike;
  prismaClient?: PrismaReadWriteClient;
}): Promise<{
  summaries: PlayerSeasonSummaryRow[];
  skippedWithoutCanonicalId: number;
}> {
  const firestore = params.firestore ?? adminDb;
  const prismaClient = params.prismaClient ?? prisma;
  const { playerMap } = await loadAllPlayersMap(prismaClient);
  const aggregates = new Map<string, AggregatedPlayer>();
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  const pageSize = 1000;
  let skippedWithoutCanonicalId = 0;

  while (true) {
    let query = firestore
      .collection('player_match_stats')
      .where('season', '==', params.season)
      .orderBy('__name__')
      .limit(pageSize);

    if (cursor) {
      query = query.startAfter(cursor);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) {
      const data = doc.data() as Record<string, unknown>;
      const playerId = readCanonicalPlayerId(data);
      if (!playerId) {
        skippedWithoutCanonicalId += 1;
        continue;
      }
      const playerProfile = playerMap.get(playerId);
      if (!playerProfile) continue;

      const matchKey = readCanonicalMatchKey(data);
      const existing: AggregatedPlayer = aggregates.get(playerId) ?? {
        playerId,
        playerName:
          typeof data.player_name === 'string' && data.player_name.trim().length > 0
            ? data.player_name.trim()
            : playerProfile.name,
        club: playerProfile.club,
        position: playerProfile.position,
        totals: buildEmptyStats(),
        gamesPlayed: 0,
        lastUpdatedAt: readUpdatedAt(data),
        seenMatchKeys: new Set<string>(),
      };

      if (existing.seenMatchKeys.has(matchKey)) continue;
      existing.seenMatchKeys.add(matchKey);
      existing.gamesPlayed += 1;

      const matchTotals = buildEmptyStats();
      matchTotals.behinds = readStat(data, 'behinds');
      matchTotals.kicks = readStat(data, 'kicks');
      matchTotals.handballs = readStat(data, 'handballs');
      matchTotals.disposals = matchTotals.kicks + matchTotals.handballs;
      matchTotals.marks = readStat(data, 'marks');
      matchTotals.tackles = readStat(data, 'tackles');
      matchTotals.goals = readStat(data, 'goals');
      matchTotals.hitouts = readStat(data, 'hitouts', ['hit_outs']);
      matchTotals.clearances = readStat(data, 'clearances');
      matchTotals.inside50s = readStat(data, 'inside50s', ['inside_50s']);
      matchTotals.rebound50s = readStat(data, 'rebound50s', ['rebound_50s']);
      matchTotals.clangers = readStat(data, 'clangers');
      matchTotals.contestedPossessions = readStat(data, 'contestedPossessions', [
        'contested_possessions',
      ]);
      matchTotals.uncontestedPossessions = readStat(data, 'uncontestedPossessions', [
        'uncontested_possessions',
      ]);
      matchTotals.freesFor = readStat(data, 'freesFor', ['frees_for']);
      matchTotals.freesAgainst = readStat(data, 'freesAgainst', ['frees_against']);
      matchTotals.onePercenters = readStat(data, 'onePercenters', ['one_percenters']);
      matchTotals.goalAssists = readStat(data, 'goalAssists', ['goal_assists']);
      matchTotals.timeOnGroundPct = readStat(data, 'timeOnGroundPct', [
        'tog_pct',
        'time_on_ground_percentage',
      ]);
      matchTotals.disposalEffPct = readStat(data, 'disposalEffPct', ['disposal_efficiency']);
      matchTotals.turnovers = readStat(data, 'turnovers');
      matchTotals.intercepts = readStat(data, 'intercepts');
      matchTotals.metresGained = readStat(data, 'metresGained', ['metres_gained']);
      matchTotals.contestedMarks = readStat(data, 'contestedMarks', ['contested_marks']);
      matchTotals.effectiveDisposals = readStat(data, 'effectiveDisposals', [
        'effective_disposals',
      ]);
      matchTotals.scoreInvolvements = readStat(data, 'scoreInvolvements', ['score_involvements']);

      addInto(existing.totals, matchTotals);

      const updatedAt = readUpdatedAt(data);
      if (updatedAt.getTime() > existing.lastUpdatedAt.getTime()) {
        existing.lastUpdatedAt = updatedAt;
      }

      aggregates.set(playerId, existing);
    }

    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < pageSize) break;
  }

  if (skippedWithoutCanonicalId > 0) {
    logger.warn('buildPlayerSeasonSummaries skipped records without canonical player_id', {
      season: params.season,
      skippedWithoutCanonicalId,
    });
  }

  const summaries: PlayerSeasonSummaryRow[] = [];
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
  }

  summaries.sort((a, b) => b.totalValue - a.totalValue);
  return {
    summaries,
    skippedWithoutCanonicalId,
  };
}

export async function persistPlayerSeasonSummaries(
  prismaClient: PrismaReadWriteClient,
  season: number,
  summaries: PlayerSeasonSummaryRow[]
): Promise<void> {
  await prismaClient.playerSeasonSummary.deleteMany({ where: { season } });

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

export function buildPlayerRankingSnapshots(
  season: number,
  summaries: PlayerSeasonSummaryRow[],
  scope = 'season',
  snapshotAt = new Date()
): PlayerRankingSnapshotRow[] {
  return summaries
    .slice()
    .sort((a, b) => b.totalValue - a.totalValue)
    .map((summary, index) => ({
      id: `${season}:${scope}:${summary.playerId}`,
      season,
      scope,
      rank: index + 1,
      playerId: summary.playerId,
      playerName: summary.playerName,
      club: summary.club,
      position: summary.position,
      gamesPlayed: summary.gamesPlayed,
      averageScore: summary.averageScore,
      totalValue: summary.totalValue,
      categories: JSON.parse(serializeCategories(summary)) as Record<string, number>,
      stats: summary.stats,
      totals: summary.totals,
      snapshotAt,
    }));
}

export async function persistPlayerRankingSnapshots(
  prismaClient: PrismaReadWriteClient,
  season: number,
  rows: PlayerRankingSnapshotRow[],
  scope = 'season'
): Promise<void> {
  await prismaClient.playerRankingSnapshot.deleteMany({ where: { season, scope } });

  if (rows.length === 0) return;

  for (let index = 0; index < rows.length; index += 250) {
    const chunk = rows.slice(index, index + 250);
    await prismaClient.playerRankingSnapshot.createMany({
      data: chunk.map((row) => ({
        id: row.id,
        season: row.season,
        scope: row.scope,
        rank: row.rank,
        playerId: row.playerId,
        playerName: row.playerName,
        club: row.club,
        position: row.position,
        gamesPlayed: row.gamesPlayed,
        averageScore: row.averageScore,
        totalValue: row.totalValue,
        categoriesJson: JSON.stringify(row.categories),
        statsJson: serializeStats(row.stats),
        totalsJson: serializeStats(row.totals),
        snapshotAt: row.snapshotAt,
      })),
    });
  }
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
}): Promise<boolean> {
  const isReady =
    params.summaryCount > 0 &&
    params.rankingCount > 0 &&
    params.summaryCount === params.rankingCount;

  if (!isReady) {
    await params.prismaClient.playerProjectionPublication.deleteMany({
      where: { season: params.season, scope: params.scope },
    });
    return false;
  }

  await params.prismaClient.playerProjectionPublication.upsert({
    where: {
      id: `${params.season}:${params.scope}`,
    },
    update: {
      summaryCount: params.summaryCount,
      rankingCount: params.rankingCount,
      rosterCount: params.rosterCount,
      publishedAt: new Date(),
    },
    create: {
      id: `${params.season}:${params.scope}`,
      season: params.season,
      scope: params.scope,
      summaryCount: params.summaryCount,
      rankingCount: params.rankingCount,
      rosterCount: params.rosterCount,
      publishedAt: new Date(),
    },
  });

  return true;
}

export async function refreshPlayerReadModels(params?: {
  season?: number;
  scope?: string;
  prismaClient?: PrismaDb;
  firestore?: FirestoreLike;
  leagueId?: string;
}): Promise<{
  season: number;
  playerSeasonSummaries: number;
  rankingSnapshots: number;
  rosterSummaries: number;
  skippedWithoutCanonicalId: number;
}> {
  const season = params?.season ?? getDefaultAflSeason();
  const scope = params?.scope ?? 'season';
  const prismaClient = params?.prismaClient ?? prisma;
  const firestore = params?.firestore ?? adminDb;

  const { summaries, skippedWithoutCanonicalId } = await buildPlayerSeasonSummaries({
    season,
    firestore,
    prismaClient,
  });
  const rankingSnapshots = buildPlayerRankingSnapshots(season, summaries, scope);

  await prismaClient.$transaction(async (tx: Prisma.TransactionClient) => {
    await persistPlayerSeasonSummaries(tx, season, summaries);
    await persistPlayerRankingSnapshots(tx, season, rankingSnapshots, scope);
  });

  const rosterSummaries = await buildLeagueRosterPlayerSummaries({
    season,
    prismaClient,
    leagueId: params?.leagueId,
  });
  await persistLeagueRosterPlayerSummaries(prismaClient, season, rosterSummaries, params?.leagueId);
  const published = await persistPlayerProjectionPublication({
    prismaClient,
    season,
    scope,
    summaryCount: summaries.length,
    rankingCount: rankingSnapshots.length,
    rosterCount: rosterSummaries.length,
  });

  logger.info('player read models refreshed', {
    season,
    scope,
    playerSeasonSummaries: summaries.length,
    rankingSnapshots: rankingSnapshots.length,
    rosterSummaries: rosterSummaries.length,
    published,
    skippedWithoutCanonicalId,
  });

  return {
    season,
    playerSeasonSummaries: summaries.length,
    rankingSnapshots: rankingSnapshots.length,
    rosterSummaries: rosterSummaries.length,
    skippedWithoutCanonicalId,
  };
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

export async function resolveLatestProjectedSeason(
  prismaClient: PrismaReadWriteClient,
  fallbackSeason = getDefaultAflSeason()
): Promise<number> {
  const publishedSeason = await prismaClient.playerProjectionPublication.findFirst({
    where: { scope: 'season', summaryCount: { gt: 0 }, rankingCount: { gt: 0 } },
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
        where: { season, scope: 'season' },
      }),
      prismaClient.playerSeasonSummary.count({ where: { season } }),
    ]);

    if (rankingCount > 0 && summaryCount > 0) {
      return season;
    }
  }

  const latestSummary = await prismaClient.playerSeasonSummary.findFirst({
    orderBy: [{ season: 'desc' }, { updatedAt: 'desc' }],
    select: { season: true },
  });
  if (latestSummary) return latestSummary.season;

  const latestRanking = await prismaClient.playerRankingSnapshot.findFirst({
    where: { scope: 'season' },
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
}): Promise<PlayerRankingSnapshotRow[]> {
  const prismaClient = params.prismaClient ?? prisma;
  const rows = await prismaClient.playerRankingSnapshot.findMany({
    where: { season: params.season, scope: params.scope ?? 'season' },
    orderBy: { rank: 'asc' },
    take: params.limit ?? undefined,
  });

  return rows.map((row) => ({
    id: row.id,
    season: row.season,
    scope: row.scope,
    rank: row.rank,
    playerId: row.playerId,
    playerName: row.playerName,
    club: row.club,
    position: row.position,
    gamesPlayed: row.gamesPlayed,
    averageScore: row.averageScore,
    totalValue: row.totalValue,
    categories: JSON.parse(row.categoriesJson) as Record<string, number>,
    stats: parseStatsJson(row.statsJson),
    totals: parseStatsJson(row.totalsJson),
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
