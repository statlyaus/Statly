export const runtime = 'nodejs';

import { type NextRequest } from 'next/server';

import { getDefaultAflSeason } from '@/lib/aflSeason';
import { commonErrors, successResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { CANONICAL_STAT_KEYS, type CanonicalStatKey } from '@/lib/stats/statColumns';
import { statsReadService } from '@/server/stats/StatsReadService';
import { prisma } from '@/lib/prisma';

function roundProjectedStats(
  stats: Record<CanonicalStatKey, number>
): Record<CanonicalStatKey, number> {
  const rounded = {} as Record<CanonicalStatKey, number>;
  for (const key of CANONICAL_STAT_KEYS) {
    rounded[key] = Number(stats[key].toFixed(1));
  }
  return rounded;
}

function copyProjectedTotals(
  stats: Record<CanonicalStatKey, number>
): Record<CanonicalStatKey, number> {
  const totals = {} as Record<CanonicalStatKey, number>;
  for (const key of CANONICAL_STAT_KEYS) {
    totals[key] = stats[key];
  }
  return totals;
}

export async function GET(_request: NextRequest, context: RouteContext<'/api/players/[id]/stats'>) {
  let playerIdForLog = 'unknown';
  try {
    const { id } = await context.params;
    playerIdForLog = id;
    const playerId = decodeURIComponent(id);

    logger.debug('Fetching stats for player', { playerId });

    const season = await statsReadService.resolveSeason(getDefaultAflSeason());
    await statsReadService.ensureSeasonReady(season);

    const [summaryMap, latestSnapshot, player] = await Promise.all([
      statsReadService.getSeasonSummaryMap(season, [playerId]),
      statsReadService.getLatestSnapshot(season, playerId),
      prisma.player.findUnique({
        where: { id: playerId },
        select: { name: true, club: true, position: true },
      }),
    ]);

    const summary = summaryMap.get(playerId);
    if (!summary) {
      return commonErrors.notFound('Player stats not found');
    }

    const playerStats = {
      playerName: summary.playerName || player?.name || playerId,
      team: player?.club || summary.club || '',
      position: player?.position || summary.position || '',
      totalGames: summary.gamesPlayed,
      averageScore: Math.round(summary.averageScore),
      totalScore: summary.totalValue,
      averagePlayerValue: Math.round(summary.averageScore),
      latestRound: latestSnapshot?.round ?? 0,
      averageStats: roundProjectedStats(summary.stats),
      totalStats: copyProjectedTotals(summary.totals),
    };

    logger.debug('Returning projected stats', {
      playerId,
      season,
      totalGames: playerStats.totalGames,
      averageScore: playerStats.averageScore,
    });
    return successResponse(playerStats);
  } catch (error) {
    logger.error('Failed to fetch player stats', error, { playerId: playerIdForLog });
    return commonErrors.internalServerError('Failed to fetch player stats');
  }
}
