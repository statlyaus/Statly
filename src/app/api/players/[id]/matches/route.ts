export const runtime = 'nodejs';

import { type NextRequest } from 'next/server';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { getRecentAflSeasons } from '@/lib/aflSeason';
import { logger } from '@/lib/logger';
import type { MatchLogRow } from '@/lib/matchLogs';
import { prisma } from '@/lib/prisma';
import {
  ensurePlayerSeasonSummariesMaterialized,
  parseMatchLogStatsJson,
} from '@/server/readModels/playerReadModels';

function parseSeasonFilter(url: URL): number[] {
  const seasonsParam = url.searchParams.get('seasons') ?? '';
  const seasonParam = url.searchParams.get('season') ?? '';

  const seasons =
    seasonsParam.trim().length > 0
      ? seasonsParam
          .split(',')
          .map((value) => Number(value.trim()))
          .filter((num) => Number.isFinite(num) && num > 0)
      : seasonParam.trim().length > 0
        ? [Number(seasonParam.trim())].filter((num) => Number.isFinite(num) && num > 0)
        : getRecentAflSeasons();

  return Array.from(new Set(seasons));
}

function sortMatchLogs(rows: MatchLogRow[]): MatchLogRow[] {
  return rows.slice().sort((a, b) => {
    const timeA = a.date.trim() ? new Date(a.date).getTime() : 0;
    const timeB = b.date.trim() ? new Date(b.date).getTime() : 0;
    if (timeA > 0 && timeB > 0 && timeA !== timeB) return timeB - timeA;
    if (timeA > 0 && timeB === 0) return -1;
    if (timeB > 0 && timeA === 0) return 1;
    return b.roundNumber - a.roundNumber;
  });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let playerIdForLog = 'unknown';

  try {
    const { id } = await params;
    const decodedId = decodeURIComponent(id);
    playerIdForLog = decodedId;

    const url = new URL(request.url);
    const debugFlag = url.searchParams.get('debug') === '1';
    const seasonFilter = parseSeasonFilter(url);

    logger.debug('Fetching matches for player', {
      playerId: decodedId,
      seasons: seasonFilter,
      source: 'projection',
    });

    const player =
      (await prisma.player.findUnique({ where: { id: decodedId } })) ??
      (await prisma.player.findFirst({ where: { name: decodedId.replace(/[_-]+/g, ' ') } }));

    const canonicalPlayerId = player?.id ?? decodedId;

    await Promise.all(
      seasonFilter.map((season) => ensurePlayerSeasonSummariesMaterialized(prisma, season))
    );

    const rows = await prisma.playerMatchLogProjection.findMany({
      where: {
        playerId: canonicalPlayerId,
        season: seasonFilter.length > 0 ? { in: seasonFilter } : undefined,
      },
      orderBy: [{ matchDate: 'desc' }, { roundNumber: 'desc' }, { matchId: 'desc' }],
    });

    if (rows.length === 0) {
      if (debugFlag) {
        return successResponse({
          rows: [],
          debug: {
            totalDocs: 0,
            processed: 0,
            droppedMissingMatchId: 0,
            droppedMissingDate: 0,
            missingDateMatchIdsCount: 0,
            missingDateMatchIdsSample: [],
            duplicateMatchIds: 0,
            duplicateMatchIdSamples: [],
            duplicateByDateOpponent: 0,
          },
        });
      }

      return successResponse([]);
    }

    const matches = sortMatchLogs(
      rows.map((row) => ({
        matchId: row.matchId,
        season: row.season,
        roundNumber: row.roundNumber,
        date: row.matchDate,
        opponent: row.opponent,
        stats: parseMatchLogStatsJson(row.statsJson),
      }))
    );

    logger.debug('Returning matches', {
      playerId: canonicalPlayerId,
      matchCount: matches.length,
      source: 'projection',
    });

    if (debugFlag) {
      const missingDateMatchIdsSample = matches
        .filter((row) => row.date.trim().length === 0)
        .slice(0, 25)
        .map((row) => row.matchId);

      return successResponse({
        rows: matches,
        debug: {
          totalDocs: rows.length,
          processed: matches.length,
          droppedMissingMatchId: 0,
          droppedMissingDate: missingDateMatchIdsSample.length,
          missingDateMatchIdsCount: missingDateMatchIdsSample.length,
          missingDateMatchIdsSample,
          duplicateMatchIds: 0,
          duplicateMatchIdSamples: [],
          duplicateByDateOpponent: 0,
        },
      });
    }

    return successResponse(matches);
  } catch (error) {
    logger.error('Failed to fetch player matches', error, { playerId: playerIdForLog });
    return commonErrors.internalServerError('Failed to fetch player matches');
  }
}
