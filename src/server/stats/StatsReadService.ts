import type { Prisma, PrismaClient } from '@prisma/client';

import { getDefaultAflSeason } from '@/lib/aflSeason';
import { prisma } from '@/lib/prisma';
import type { CanonicalStatKey } from '@/lib/stats/statColumns';
import {
  ensurePlayerSeasonSummariesMaterialized,
  getPlayerSeasonSummaryMap,
  listPlayerRankingSnapshots,
  parseStatsJson,
  resolveLatestProjectedSeason,
} from '@/server/readModels/playerReadModels';

type PrismaReadClient = PrismaClient | Prisma.TransactionClient;

export type PlayerProjectionSummary = {
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

export type PlayerRecentFormProjection = {
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

export type PlayerLatestSnapshotProjection = {
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

export type PlayerMatchLogProjection = {
  playerId: string;
  season: number;
  roundNumber: number;
  matchId: string;
  date: string;
  opponent: string;
  stats: Record<CanonicalStatKey, number>;
};

export type RankingPeriodSelection =
  | { kind: 'season'; season: number }
  | { kind: 'recent_form'; season: number; window: 'last3' | 'last5' | 'last10' };

function toLatestSnapshot(row: {
  playerId: string;
  season: number;
  matchUid: string | null;
  round: number | null;
  statSource: string;
  isLive: boolean;
  lastSeenAt: Date | null;
  averageScore: number;
  totalValue: number;
  statsJson: string;
  totalsJson: string;
  sourceUpdatedAt: Date;
}): PlayerLatestSnapshotProjection {
  return {
    playerId: row.playerId,
    season: row.season,
    matchUid: row.matchUid,
    round: row.round,
    statSource: row.statSource,
    isLive: row.isLive,
    lastSeenAt: row.lastSeenAt,
    averageScore: row.averageScore,
    totalValue: row.totalValue,
    stats: parseStatsJson(row.statsJson),
    totals: parseStatsJson(row.totalsJson),
    sourceUpdatedAt: row.sourceUpdatedAt,
  };
}

function toRecentForm(row: {
  playerId: string;
  season: number;
  window: string;
  gamesIncluded: number;
  averageScore: number;
  totalValue: number;
  statsJson: string;
  totalsJson: string;
  sourceUpdatedAt: Date;
}): PlayerRecentFormProjection {
  return {
    playerId: row.playerId,
    season: row.season,
    window: row.window,
    gamesIncluded: row.gamesIncluded,
    averageScore: row.averageScore,
    totalValue: row.totalValue,
    stats: parseStatsJson(row.statsJson),
    totals: parseStatsJson(row.totalsJson),
    sourceUpdatedAt: row.sourceUpdatedAt,
  };
}

export class StatsReadService {
  constructor(private readonly prismaClient: PrismaReadClient = prisma) {}

  async resolveSeason(fallbackSeason = getDefaultAflSeason()): Promise<number> {
    return resolveLatestProjectedSeason(this.prismaClient, fallbackSeason);
  }

  async ensureSeasonReady(season: number): Promise<void> {
    await ensurePlayerSeasonSummariesMaterialized(this.prismaClient as PrismaClient, season);
  }

  selectRankingPeriod(input: {
    season?: number | null;
    period?: string | null;
    fallbackSeason?: number;
  }): RankingPeriodSelection {
    const season = input.season ?? input.fallbackSeason ?? getDefaultAflSeason();
    const period = String(input.period ?? 'season')
      .trim()
      .toLowerCase();

    if (period === 'season' || period === '') {
      return { kind: 'season', season };
    }

    if (period === 'last3' || period === 'last5' || period === 'last10') {
      return {
        kind: 'recent_form',
        season,
        window: period,
      };
    }

    throw new Error(
      `Unsupported ranking period "${period}". Supported periods are season, last3, last5, last10.`
    );
  }

  async getSeasonSummaryMap(
    season: number,
    playerIds: string[]
  ): Promise<Map<string, PlayerProjectionSummary>> {
    const rows = await getPlayerSeasonSummaryMap(this.prismaClient, season, playerIds);
    return new Map(
      Array.from(rows.entries()).map(([playerId, row]) => [
        playerId,
        {
          playerId,
          playerName: row.playerName,
          club: row.club,
          position: row.position,
          gamesPlayed: row.gamesPlayed,
          averageScore: row.averageScore,
          totalValue: row.totalValue,
          stats: row.stats,
          totals: row.totals,
        },
      ])
    );
  }

  async getLatestSnapshotMap(
    season: number,
    playerIds: string[]
  ): Promise<Map<string, PlayerLatestSnapshotProjection>> {
    if (playerIds.length === 0) return new Map();
    const rows = await this.prismaClient.playerLatestSnapshot.findMany({
      where: { season, playerId: { in: playerIds } },
    });
    return new Map(rows.map((row) => [row.playerId, toLatestSnapshot(row)] as const));
  }

  async getLatestSnapshot(
    season: number,
    playerId: string
  ): Promise<PlayerLatestSnapshotProjection | null> {
    const row = await this.prismaClient.playerLatestSnapshot.findUnique({
      where: {
        playerId_season: {
          playerId,
          season,
        },
      },
    });
    return row ? toLatestSnapshot(row) : null;
  }

  async getRecentFormMap(
    season: number,
    playerIds: string[],
    window: 'last3' | 'last5' | 'last10'
  ): Promise<Map<string, PlayerRecentFormProjection>> {
    if (playerIds.length === 0) return new Map();
    const rows = await this.prismaClient.playerRecentFormSummary.findMany({
      where: { season, window, playerId: { in: playerIds } },
    });
    return new Map(rows.map((row) => [row.playerId, toRecentForm(row)] as const));
  }

  async listSeasonSummaries(params: {
    season: number;
    playerIds?: string[];
  }): Promise<PlayerProjectionSummary[]> {
    const rows = await this.prismaClient.playerSeasonSummary.findMany({
      where: {
        season: params.season,
        playerId: params.playerIds?.length ? { in: params.playerIds } : undefined,
      },
      orderBy: [{ totalValue: 'desc' }, { playerName: 'asc' }],
    });

    return rows.map((row) => ({
      playerId: row.playerId,
      playerName: row.playerName,
      club: row.club,
      position: row.position,
      gamesPlayed: row.gamesPlayed,
      averageScore: row.averageScore,
      totalValue: row.totalValue,
      stats: parseStatsJson(row.statsJson),
      totals: parseStatsJson(row.totalsJson),
    }));
  }

  async listRecentFormSummaries(params: {
    season: number;
    window: 'last3' | 'last5' | 'last10';
    playerIds?: string[];
  }): Promise<PlayerRecentFormProjection[]> {
    const rows = await this.prismaClient.playerRecentFormSummary.findMany({
      where: {
        season: params.season,
        window: params.window,
        playerId: params.playerIds?.length ? { in: params.playerIds } : undefined,
      },
      orderBy: [{ totalValue: 'desc' }, { playerId: 'asc' }],
    });

    return rows.map((row) => toRecentForm(row));
  }

  async listRankingProjectionRows(
    selection: RankingPeriodSelection
  ): Promise<
    Array<
      | (PlayerProjectionSummary & { projectionKind: 'season' })
      | (PlayerRecentFormProjection & { projectionKind: 'recent_form' })
    >
  > {
    if (selection.kind === 'season') {
      const rows = await this.listSeasonSummaries({ season: selection.season });
      return rows.map((row) => ({
        ...row,
        projectionKind: 'season' as const,
      }));
    }

    const rows = await this.listRecentFormSummaries({
      season: selection.season,
      window: selection.window,
    });
    return rows.map((row) => ({
      ...row,
      projectionKind: 'recent_form' as const,
    }));
  }

  async listPlayerMatchLogs(_params: {
    playerId: string;
    seasons: number[];
  }): Promise<PlayerMatchLogProjection[]> {
    // Intentionally projection-only. Match-log route cutover should only happen once
    // a dedicated Prisma-backed match projection exists.
    return [];
  }

  async listRankings(params: { season: number; scope?: string; limit?: number | null }) {
    return listPlayerRankingSnapshots({
      prismaClient: this.prismaClient,
      season: params.season,
      scope: params.scope,
      limit: params.limit,
    });
  }
}

export const statsReadService = new StatsReadService();
