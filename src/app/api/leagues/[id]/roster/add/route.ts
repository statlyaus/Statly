export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { createErrorResponse, errorResponse, successResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { resolveCanonicalPlayerId } from '@/server/players/playerIdentityService';
import { LeagueBusyError } from '@/server/leagues/leagueRowLock';
import {
  addFreeAgentToRoster,
  FreeAgentAddError,
  listDropCandidates,
} from '@/server/rosters/freeAgentAdd';
import { WaiverAvailabilityProjectionService } from '@/server/waivers/WaiverAvailabilityProjectionService';
import { findWaiverPlayerAliasIds } from '@/server/waivers/waiverPlayerIdentity';

/**
 * Adds a free agent to the caller's roster. With `dropPlayerId` (a player on that roster), the drop
 * commits in the same transaction as the add ("add and drop"). A full roster without a drop is
 * refused with ROSTER_FULL and `details.dropCandidates`, the players the caller could drop.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let leagueId = '';
  let userId: string | null = null;
  try {
    ({ id: leagueId } = await params);
    userId = await getAuthenticatedUserId(request);
    if (!userId) return errorResponse('Unauthorized', 401);

    const body = (await request.json().catch(() => ({}))) as {
      playerId?: unknown;
      dropPlayerId?: unknown;
    };
    const requestedPlayerId = typeof body.playerId === 'string' ? body.playerId.trim() : '';
    const requestedDropPlayerId =
      typeof body.dropPlayerId === 'string' ? body.dropPlayerId.trim() : '';
    if (body.dropPlayerId !== undefined && !requestedDropPlayerId) {
      return errorResponse('Drop player ID must be a non-empty string', 400);
    }
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
    let drop: { playerId: string; playerAliasIds: string[] } | undefined;
    if (requestedDropPlayerId) {
      // A drop id the identity service cannot resolve may still be the id an old roster row holds.
      const dropPlayerId =
        (await resolveCanonicalPlayerId(requestedDropPlayerId)) ?? requestedDropPlayerId;
      drop = {
        playerId: dropPlayerId,
        playerAliasIds: [
          requestedDropPlayerId,
          ...findWaiverPlayerAliasIds(activePlayers, dropPlayerId),
        ],
      };
    }
    const added = await addFreeAgentToRoster(prisma, {
      leagueId,
      userId,
      playerId,
      playerAliasIds: [requestedPlayerId, ...findWaiverPlayerAliasIds(activePlayers, playerId)],
      drop,
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
      dropped: added.dropped
        ? {
            playerId: added.dropped.playerId,
            actionId: added.dropped.actionId,
            processingAt: added.dropped.processingAt.toISOString(),
          }
        : null,
    });
  } catch (error) {
    if (error instanceof FreeAgentAddError) {
      if (error.code === 'ROSTER_FULL' && userId) {
        const dropCandidates = await listDropCandidates(prisma, { leagueId, userId }).catch(
          () => []
        );
        return errorResponse(error.message, error.status, error.code, { dropCandidates });
      }
      return errorResponse(error.message, error.status, error.code);
    }
    // Round scoring or another move holds the League row: say so instead of a bare 500.
    if (error instanceof LeagueBusyError) {
      return errorResponse(error.message, error.status, error.code);
    }
    logger.error('Failed to add player to roster', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to add player to roster', 500);
  }
}
