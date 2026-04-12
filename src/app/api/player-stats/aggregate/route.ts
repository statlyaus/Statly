import { NextResponse, type NextRequest } from 'next/server';

import { getDefaultAflSeason } from '@/lib/aflSeason';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { redisClient } from '@/lib/redis';
import {
  listPlayerRankingSnapshots,
  resolveLatestProjectedSeason,
} from '@/server/readModels/playerReadModels';
import type { PlayerStats } from '@/types/fantasyCategories';

export const runtime = 'nodejs';

type AggregatedPlayerStat = {
  id: string;
  player_id: string;
  player_name: string;
  team: string;
  position: string;
  season: number;
  games: number;
  totalValue: number;
  fantasy_points: number;
  totals: PlayerStats;
  averages: PlayerStats;
  categories: {
    goals: number;
    tackles: number;
    inside50s: number;
    intercepts: number;
    contestedMarks: number;
    rebound50s: number;
    contestedPossessions: number;
    effectiveDisposals: number;
    scoreInvolvements: number;
  };
  tenthCell: {
    type: string;
    value: number;
    label: string;
  };
  lastRound?: number;
  lastUpdated: string;
};

const CACHE_TTL_SECONDS = 60 * 15;

function parseNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

async function resolveSeason(): Promise<number> {
  try {
    return await resolveLatestProjectedSeason(prisma, getDefaultAflSeason());
  } catch {
    return getDefaultAflSeason();
  }
}

async function getCached(key: string): Promise<AggregatedPlayerStat[] | null> {
  try {
    if (!redisClient.isConnected()) {
      await redisClient.connect();
    }
    const cached = await redisClient.get(key);
    if (!cached) return null;
    const parsed = JSON.parse(cached) as AggregatedPlayerStat[];
    return Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    logger.warn('player-stats aggregate cache read failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function setCached(key: string, data: AggregatedPlayerStat[]): Promise<void> {
  try {
    if (!redisClient.isConnected()) {
      await redisClient.connect();
    }
    await redisClient.set(key, JSON.stringify(data), CACHE_TTL_SECONDS);
  } catch (error) {
    logger.warn('player-stats aggregate cache write failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function toPlayerStats(row: {
  gamesPlayed: number;
  stats: Record<string, number>;
  totals: Record<string, number>;
}): { averages: PlayerStats; totals: PlayerStats } {
  const games = Math.max(1, row.gamesPlayed);
  return {
    totals: {
      games,
      kicks: parseNumber(row.totals.kicks),
      handballs: parseNumber(row.totals.handballs),
      marks: parseNumber(row.totals.marks),
      tackles: parseNumber(row.totals.tackles),
      goals: parseNumber(row.totals.goals),
      hitouts: parseNumber(row.totals.hitouts),
      clearances: parseNumber(row.totals.clearances),
      inside50s: parseNumber(row.totals.inside50s),
      rebound50s: parseNumber(row.totals.rebound50s),
      clangers: parseNumber(row.totals.clangers),
      contestedPossessions: parseNumber(row.totals.contestedPossessions),
      uncontestedPossessions: parseNumber(row.totals.uncontestedPossessions),
      freesFor: parseNumber(row.totals.freesFor),
      freesAgainst: parseNumber(row.totals.freesAgainst),
      onePercenters: parseNumber(row.totals.onePercenters),
      goalAssists: parseNumber(row.totals.goalAssists),
      timeOnGroundPct: parseNumber(row.totals.timeOnGroundPct),
      disposalEffPct: parseNumber(row.totals.disposalEffPct),
      turnovers: parseNumber(row.totals.turnovers),
      intercepts: parseNumber(row.totals.intercepts),
      metresGained: parseNumber(row.totals.metresGained),
      contestedMarks: parseNumber(row.totals.contestedMarks),
      effectiveDisposals: parseNumber(row.totals.effectiveDisposals),
      scoreInvolvements: parseNumber(row.totals.scoreInvolvements),
      seasonTotal: undefined,
      avgFantasyPoints: undefined,
      lastGameFantasyPoints: undefined,
    },
    averages: {
      games,
      kicks: parseNumber(row.stats.kicks),
      handballs: parseNumber(row.stats.handballs),
      marks: parseNumber(row.stats.marks),
      tackles: parseNumber(row.stats.tackles),
      goals: parseNumber(row.stats.goals),
      hitouts: parseNumber(row.stats.hitouts),
      clearances: parseNumber(row.stats.clearances),
      inside50s: parseNumber(row.stats.inside50s),
      rebound50s: parseNumber(row.stats.rebound50s),
      clangers: parseNumber(row.stats.clangers),
      contestedPossessions: parseNumber(row.stats.contestedPossessions),
      uncontestedPossessions: parseNumber(row.stats.uncontestedPossessions),
      freesFor: parseNumber(row.stats.freesFor),
      freesAgainst: parseNumber(row.stats.freesAgainst),
      onePercenters: parseNumber(row.stats.onePercenters),
      goalAssists: parseNumber(row.stats.goalAssists),
      timeOnGroundPct: parseNumber(row.stats.timeOnGroundPct),
      disposalEffPct: parseNumber(row.stats.disposalEffPct),
      turnovers: parseNumber(row.stats.turnovers),
      intercepts: parseNumber(row.stats.intercepts),
      metresGained: parseNumber(row.stats.metresGained),
      contestedMarks: parseNumber(row.stats.contestedMarks),
      effectiveDisposals: parseNumber(row.stats.effectiveDisposals),
      scoreInvolvements: parseNumber(row.stats.scoreInvolvements),
      seasonTotal: undefined,
      avgFantasyPoints: undefined,
      lastGameFantasyPoints: undefined,
    },
  };
}

async function getSnapshotVersion(season: number): Promise<string> {
  const latest = await prisma.playerRankingSnapshot.findFirst({
    where: { season, scope: 'season' },
    orderBy: { snapshotAt: 'desc' },
    select: { snapshotAt: true },
  });
  return latest?.snapshotAt.toISOString() ?? 'missing';
}

async function readFromSnapshots(
  season: number,
  limit: number | null
): Promise<AggregatedPlayerStat[]> {
  const snapshots = await listPlayerRankingSnapshots({
    season,
    limit,
  });

  return snapshots.map((snapshot) => {
    const { averages, totals } = toPlayerStats(snapshot);
    return {
      id: snapshot.playerId,
      player_id: snapshot.playerId,
      player_name: snapshot.playerName,
      team: snapshot.club,
      position: snapshot.position,
      season,
      games: snapshot.gamesPlayed,
      totalValue: snapshot.totalValue,
      fantasy_points: snapshot.totalValue,
      totals,
      averages,
      categories: {
        goals: parseNumber(snapshot.categories.goals),
        tackles: parseNumber(snapshot.categories.tackles),
        inside50s: parseNumber(snapshot.categories.inside50s),
        intercepts: parseNumber(snapshot.categories.intercepts),
        contestedMarks: parseNumber(snapshot.categories.contestedMarks),
        rebound50s: parseNumber(snapshot.categories.rebound50s),
        contestedPossessions: parseNumber(snapshot.categories.contestedPossessions),
        effectiveDisposals: parseNumber(snapshot.categories.effectiveDisposals),
        scoreInvolvements: parseNumber(snapshot.categories.scoreInvolvements),
      },
      tenthCell: {
        type: 'efficiency',
        value: Math.round(parseNumber(snapshot.stats.disposalEffPct)),
        label: 'DE%',
      },
      lastUpdated: snapshot.snapshotAt.toISOString(),
    } satisfies AggregatedPlayerStat;
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const seasonParam = searchParams.get('season');
  const roundParam = searchParams.get('round');
  const limitParam = searchParams.get('limit');
  const refresh = searchParams.get('refresh') === 'true';

  const season = seasonParam ? parseInt(seasonParam, 10) : await resolveSeason();
  const round = roundParam ? parseInt(roundParam, 10) : null;
  const limit = limitParam ? Math.max(1, Math.min(parseInt(limitParam, 10), 1000)) : null;

  if (round !== null) {
    return NextResponse.json(
      {
        success: false,
        error: 'Round-scoped rankings are not projected yet',
      },
      { status: 409 }
    );
  }

  if (refresh) {
    return NextResponse.json(
      {
        success: false,
        error: 'Manual refresh is not allowed on public routes',
      },
      { status: 403, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const snapshotVersion = await getSnapshotVersion(season);
  const cacheKey = `player-stats:aggregate:${season}:${snapshotVersion}:${limit ?? 'all'}`;
  if (!refresh) {
    const cached = await getCached(cacheKey);
    if (cached) {
      return NextResponse.json(
        { success: true, data: cached, count: cached.length, source: 'cache' },
        { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } }
      );
    }
  }

  try {
    const rows = await readFromSnapshots(season, limit);

    if (rows.length === 0) {
      logger.error('player-stats aggregate snapshot missing', {
        season,
      });
      return NextResponse.json(
        {
          success: false,
          error: 'Projected ranking snapshot is unavailable',
          query: { season, limit },
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    await setCached(cacheKey, rows);
    return NextResponse.json(
      {
        success: true,
        data: rows,
        count: rows.length,
        source: 'snapshot',
        query: { season, round, limit },
      },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } }
    );
  } catch (error) {
    logger.error('player-stats aggregate failed', error as Error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to aggregate player stats',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
