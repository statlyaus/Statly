import { prisma } from '@/lib/prisma';
import { resolveLatestProjectedSeason } from '@/server/readModels/playerReadModels';

function isStrictReadModelEvaluation(): boolean {
  if (process.env.HEALTH_LENIENT_READ_MODELS === 'true') {
    return false;
  }
  if (process.env.HEALTH_STRICT_READ_MODELS === 'true') {
    return true;
  }
  return process.env.NODE_ENV === 'production';
}

export type PlayerReadModelHealthSummary = {
  status: 'healthy' | 'degraded' | 'unhealthy';
  error?: string;
  details: {
    playerCount: number;
    resolvedSeason: number;
    seasonSummaryCount: number;
    totalSummaryRows: number;
    /** True when players exist but there are no summaries for the resolved API season (all environments). */
    summaryGapDetected: boolean;
    /** strict → degraded when summaryGapDetected; lenient → healthy overall but gap still visible in summaryGapDetected. */
    evaluationMode: 'strict' | 'lenient';
    latestSummaryUpdatedAt: string | null;
    latestPublication: {
      season: number;
      summaryCount: number;
      rankingCount: number;
      publishedAt: string;
    } | null;
  };
  lastChecked: string;
};

/**
 * Surfaces Prisma player read-model coverage for ops (GET /api/health).
 * Degraded when summaryGapDetected and strict evaluation (see isStrictReadModelEvaluation / docs/DATA_RELIABILITY.md).
 * See docs/DATA_RELIABILITY.md.
 */
export async function getPlayerReadModelHealth(): Promise<PlayerReadModelHealthSummary> {
  const lastChecked = new Date().toISOString();

  try {
    const [playerCount, resolvedSeason, totalSummaryRows, latestSummary, latestPublication] =
      await Promise.all([
        prisma.player.count(),
        resolveLatestProjectedSeason(prisma),
        prisma.playerSeasonSummary.count(),
        prisma.playerSeasonSummary.findFirst({
          orderBy: [{ updatedAt: 'desc' }],
          select: { updatedAt: true },
        }),
        prisma.playerProjectionPublication.findFirst({
          orderBy: [{ publishedAt: 'desc' }],
          select: { season: true, summaryCount: true, rankingCount: true, publishedAt: true },
        }),
      ]);

    const seasonSummaryCount = await prisma.playerSeasonSummary.count({
      where: { season: resolvedSeason },
    });

    const summaryGapDetected = playerCount > 0 && seasonSummaryCount === 0;
    const strict = isStrictReadModelEvaluation();
    const evaluationMode: PlayerReadModelHealthSummary['details']['evaluationMode'] = strict
      ? 'strict'
      : 'lenient';

    const status: PlayerReadModelHealthSummary['status'] =
      summaryGapDetected && strict ? 'degraded' : 'healthy';

    return {
      status,
      details: {
        playerCount,
        resolvedSeason,
        seasonSummaryCount,
        totalSummaryRows,
        summaryGapDetected,
        evaluationMode,
        latestSummaryUpdatedAt: latestSummary?.updatedAt.toISOString() ?? null,
        latestPublication: latestPublication
          ? {
              season: latestPublication.season,
              summaryCount: latestPublication.summaryCount,
              rankingCount: latestPublication.rankingCount,
              publishedAt: latestPublication.publishedAt.toISOString(),
            }
          : null,
      },
      lastChecked,
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error:
        process.env.NODE_ENV === 'production'
          ? 'Player read-model health check failed'
          : error instanceof Error
            ? error.message
            : String(error),
      details: {
        playerCount: 0,
        resolvedSeason: 0,
        seasonSummaryCount: 0,
        totalSummaryRows: 0,
        summaryGapDetected: false,
        evaluationMode: isStrictReadModelEvaluation() ? 'strict' : 'lenient',
        latestSummaryUpdatedAt: null,
        latestPublication: null,
      },
      lastChecked,
    };
  }
}
