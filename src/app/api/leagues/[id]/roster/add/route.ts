export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { createErrorResponse, errorResponse, successResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { resolveCanonicalPlayerId } from '@/server/players/playerIdentityService';
import { addFreeAgentToRoster, FreeAgentAddError } from '@/server/rosters/freeAgentAdd';
import { WaiverAvailabilityProjectionService } from '@/server/waivers/WaiverAvailabilityProjectionService';
import { findWaiverPlayerAliasIds } from '@/server/waivers/waiverPlayerIdentity';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: leagueId } = await params;
    const userId = await getAuthenticatedUserId(request);
    if (!userId) return errorResponse('Unauthorized', 401);

    const body = (await request.json().catch(() => ({}))) as { playerId?: unknown };
    const requestedPlayerId = typeof body.playerId === 'string' ? body.playerId.trim() : '';
    if (!leagueId || !requestedPlayerId)
      return errorResponse('League ID and player ID are required', 400);
    const playerId = await resolveCanonicalPlayerId(requestedPlayerId);
    if (!playerId) {
      return NextResponse.json(createErrorResponse('Player not found', 'NOT_FOUND'), {
        status: 404,
      });
    }

    // Roster rows can still hold an alias id, so ownership is checked across every alias.
    const activePlayers = await prisma.player.findMany({
      where: { active: true },
      select: { id: true, name: true, club: true, position: true },
    });
    const added = await addFreeAgentToRoster(prisma, {
      leagueId,
      userId,
      playerId,
      playerAliasIds: [requestedPlayerId, ...findWaiverPlayerAliasIds(activePlayers, playerId)],
    });

    const playerIds = await prisma.leagueRosterPlayer.findMany({
      where: { leagueId, memberId: added.memberId },
      select: { playerId: true },
      orderBy: [{ acquiredAt: 'asc' }, { createdAt: 'asc' }],
    });

    await Promise.allSettled([
      new WaiverAvailabilityProjectionService().projectLeague({ leagueId }),
    ]);

    return successResponse({
      leagueId,
      playerId,
      rosterId: added.rosterPlayerId,
      playerIds: playerIds.map((p) => p.playerId),
    });
  } catch (error) {
    if (error instanceof FreeAgentAddError) {
      return errorResponse(error.message, error.status, error.code);
    }
    logger.error('Failed to add player to roster', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to add player to roster', 500);
  }
}
