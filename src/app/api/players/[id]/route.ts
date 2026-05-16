export const runtime = 'nodejs';

import { type NextRequest } from 'next/server';

import { getDefaultAflSeason } from '@/lib/aflSeason';
import { commonErrors, successResponse } from '@/lib/apiResponse';
import { getPlayer } from '@/lib/data';
import { verifyLeagueMembership } from '@/lib/leagueMembership';
import { getLeagueOwnershipMap } from '@/lib/leagueOwnership';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import {
  buildCanonicalStatSnapshot,
  canonicalStatsToApiSnapshot,
} from '@/lib/stats/playerStatSnapshot';
import { statsReadService } from '@/server/stats/StatsReadService';
import type { Player } from '@/types/players';

type LatestPlayerStats = {
  stats: ReturnType<typeof canonicalStatsToApiSnapshot>;
  team?: string;
  playerName?: string;
};

async function getLatestStatsByPlayerId(playerId: string): Promise<LatestPlayerStats | null> {
  const season = await statsReadService.resolveSeason(getDefaultAflSeason());
  await statsReadService.ensureSeasonReady(season);
  const latest = await statsReadService.getLatestSnapshot(season, playerId);
  if (!latest) return null;

  return {
    stats: canonicalStatsToApiSnapshot(buildCanonicalStatSnapshot(latest.stats)),
    playerName: undefined,
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let playerIdForLog = 'unknown';
  try {
    const { id } = await params;
    playerIdForLog = id;
    const leagueId = new URL(request.url).searchParams.get('leagueId') || undefined;

    const decodedId = decodeURIComponent(id);
    const nameCandidate = decodedId.replace(/[_-]+/g, ' ');
    let fallbackPlayer: Player | null = null;

    let player = await prisma.player.findUnique({ where: { id: decodedId } });
    if (!player) {
      fallbackPlayer = await getPlayer(decodedId);
    }
    if (!player && fallbackPlayer?.id) {
      player = await prisma.player.findUnique({ where: { id: fallbackPlayer.id } });
    }
    if (!player) {
      player = await prisma.player.findFirst({
        where: { name: nameCandidate },
      });
    }

    let responsePlayer: Player | null = null;
    if (player) {
      const latest = await getLatestStatsByPlayerId(player.id);
      const stats = latest?.stats ?? null;
      responsePlayer = {
        id: player.id,
        name: player.name,
        team: latest?.team ?? player.club,
        position: player.position,
        ...(stats ?? {}),
        stats: stats ?? {},
      };
    }

    if (!responsePlayer && fallbackPlayer) {
      const latest = await getLatestStatsByPlayerId(fallbackPlayer.id);
      responsePlayer = latest
        ? {
            ...fallbackPlayer,
            team: latest.team ?? fallbackPlayer.team,
            ...(latest.stats ?? {}),
            stats: latest.stats ?? fallbackPlayer.stats ?? {},
          }
        : fallbackPlayer;
    }

    if (!responsePlayer) {
      const latest = await getLatestStatsByPlayerId(decodedId);
      if (latest?.playerName) {
        responsePlayer = {
          id: decodedId,
          name: latest.playerName,
          team: latest.team,
          ...(latest.stats ?? {}),
          stats: latest.stats ?? {},
        };
      }
    }

    if (!responsePlayer) {
      return commonErrors.notFound('Player not found');
    }

    if (leagueId) {
      const uid = await getAuthenticatedUserId(request);
      if (!uid) return commonErrors.unauthorized();
      const membership = await verifyLeagueMembership(leagueId, uid);
      if (!membership.isMember) return commonErrors.forbidden('Forbidden');
      const { totalTeams, counts } = await getLeagueOwnershipMap(leagueId, [responsePlayer.id]);
      const count = counts.get(responsePlayer.id) ?? 0;
      const ownership = totalTeams > 0 ? Math.round((count / totalTeams) * 100) : 0;
      responsePlayer = { ...responsePlayer, ownership };
    }

    return successResponse(responsePlayer);
  } catch (error) {
    logger.error('Failed to fetch player', error, { playerId: playerIdForLog });
    return commonErrors.internalServerError('Failed to fetch player');
  }
}
