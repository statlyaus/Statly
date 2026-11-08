import type { Prisma } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { inActiveSeason, requireActiveSeasonId } from '@/server/leagues/activeSeason';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { verifyLeagueMembership } from '@/lib/leagueMembership';
import { findLockedOutPlayers, PLAYER_LOCKED_REASON } from '@/server/leagues/playerLockout';
import { resolveCanonicalPlayerIds } from '@/server/players/playerIdentityService';
import { WaiverAvailabilityProjectionService } from '@/server/waivers/WaiverAvailabilityProjectionService';

// GET /api/leagues/[id]/actions/[userId] - Get user's team actions
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { id: leagueId, userId } = await params;

    if (!leagueId || !userId) {
      return errorResponse('League ID and User ID are required', 400);
    }

    const authorization = await authorizeTeamActionRequest(request, leagueId, userId);
    if ('response' in authorization) {
      return authorization.response;
    }

    // Get user's member record
    const member = await prisma.leagueMember.findFirst({
      where: {
        leagueId,
        userId,
      },
    });

    if (!member) {
      return errorResponse('User is not a member of this league', 404);
    }

    const actions = await prisma.teamAction.findMany({
      where: { leagueId, ...inActiveSeason(leagueId), memberId: member.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const formattedActions = actions.map((action) => ({
      id: action.id,
      actionType: action.actionType,
      status: action.status,
      details: action.details,
      targetMemberId: action.targetMemberId,
      processingAt: action.processingAt,
      processedAt: action.processedAt,
      createdAt: action.createdAt,
      updatedAt: action.updatedAt,
    }));

    return successResponse({
      actions: formattedActions,
    });
  } catch (error) {
    logger.error('Failed to get team actions', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to retrieve team actions', 500);
  }
}

// POST /api/leagues/[id]/actions/[userId] - Create new team action
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { id: leagueId, userId } = await params;

    if (!leagueId || !userId) {
      return errorResponse('League ID and User ID are required', 400);
    }

    const authorization = await authorizeTeamActionRequest(request, leagueId, userId);
    if ('response' in authorization) {
      return authorization.response;
    }

    const body = await request.json();

    const { actionType, details } = body;

    if (!actionType || !details) {
      return errorResponse('Action type and details are required', 400);
    }
    if (typeof details !== 'object' || Array.isArray(details)) {
      return errorResponse('Action details must be an object', 400);
    }
    // Waiver claims go through WaiverProcessingService (FAAB reservation, priority, schedule) and
    // trades through the trade service. A row written here would skip both, so only drops land.
    if (actionType !== 'DROP_PLAYER') {
      return errorResponse('Only DROP_PLAYER actions are accepted here', 400);
    }
    const canonicalDetails = await resolveTeamActionPlayerIds(details);

    // Get user's member record
    const member = await prisma.leagueMember.findFirst({
      where: {
        leagueId,
        userId,
      },
    });

    if (!member) {
      return errorResponse('User is not a member of this league', 404);
    }

    // The player must be on this member's roster in this league.
    const validationResult = await validateDropPlayerAction(canonicalDetails, leagueId, member.id);
    if (!validationResult.valid) {
      return errorResponse(validationResult.error || 'Invalid action', 400);
    }

    const playerId = String(canonicalDetails.playerId);
    // Rolling lockout: a player whose AFL game has started this round stays until the round ends.
    const lockout = await findLockedOutPlayers({ leagueId, playerIds: [playerId] });
    if (!lockout.ok) return errorResponse(lockout.reason, 503, lockout.code);
    if (lockout.lockedPlayerIds.has(playerId)) {
      return errorResponse(PLAYER_LOCKED_REASON, 409, 'PLAYER_LOCKED');
    }

    // Dropped players leave the roster now, then stay on waivers before free agency. The roster
    // delete and the waiver hold commit together, so a reported drop always has its hold.
    const processingAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const actionId = `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const dropped = await prisma.$transaction(async (tx) => {
      const removed = await tx.leagueRosterPlayer.deleteMany({
        where: { leagueId, memberId: member.id, playerId },
      });
      if (removed.count === 0) return false;
      await tx.teamAction.create({
        data: {
          id: actionId,
          leagueId,
          seasonId: await requireActiveSeasonId(tx, leagueId),
          memberId: member.id,
          actionType: 'DROP_PLAYER',
          // The details came from the parsed JSON request body, so they are JSON values.
          details: canonicalDetails as Prisma.InputJsonObject,
          processingAt,
        },
      });
      return true;
    });
    if (!dropped) {
      return errorResponse('Player is no longer in your roster', 409);
    }

    const action = {
      id: actionId,
      leagueId,
      memberId: member.id,
      actionType,
      details: canonicalDetails,
      targetMemberId: null,
      processingAt,
      createdAt: new Date(),
      status: 'PENDING',
    };

    await projectCommittedDrop({ actionId, leagueId, memberId: member.id, playerId });

    logger.info('Created team action', {
      leagueId,
      memberId: member.id,
      actionType,
      actionId: action.id,
    });

    return successResponse({
      action: {
        id: action.id,
        actionType: action.actionType,
        status: action.status,
        details: action.details,
        targetMemberId: action.targetMemberId,
        processingAt: action.processingAt,
        createdAt: action.createdAt,
      },
    });
  } catch (error) {
    logger.error('Failed to create team action', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to create team action', 500);
  }
}

async function resolveTeamActionPlayerIds(
  details: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const canonicalDetails = { ...details };
  const scalarKeys = ['playerId', 'dropPlayerId'] as const;
  const arrayKeys = ['offeredPlayers', 'requestedPlayers'] as const;
  const requestedPlayerIds = [
    ...scalarKeys.flatMap((key) =>
      typeof canonicalDetails[key] === 'string' ? [canonicalDetails[key] as string] : []
    ),
    ...arrayKeys.flatMap((key) =>
      Array.isArray(canonicalDetails[key])
        ? (canonicalDetails[key] as unknown[]).filter(
            (playerId): playerId is string => typeof playerId === 'string'
          )
        : []
    ),
  ];
  const resolvedPlayerIds = await resolveCanonicalPlayerIds(requestedPlayerIds);
  const canonicalPlayerId = (playerId: string) =>
    resolvedPlayerIds.get(playerId.trim()) ?? playerId;

  for (const key of scalarKeys) {
    const requestedPlayerId = canonicalDetails[key];
    if (typeof requestedPlayerId !== 'string') continue;
    canonicalDetails[key] = canonicalPlayerId(requestedPlayerId);
  }
  for (const key of arrayKeys) {
    const requestedPlayerIdsForKey = canonicalDetails[key];
    if (!Array.isArray(requestedPlayerIdsForKey)) continue;
    canonicalDetails[key] = requestedPlayerIdsForKey.map((playerId) =>
      typeof playerId === 'string' ? canonicalPlayerId(playerId) : playerId
    );
  }
  return canonicalDetails;
}

async function authorizeTeamActionRequest(
  request: NextRequest,
  leagueId: string,
  routeUserId: string
) {
  const authenticatedUserId = await getAuthenticatedUserId(request);
  if (!authenticatedUserId) {
    return { response: errorResponse('Unauthorized', 401) };
  }

  if (authenticatedUserId !== routeUserId) {
    return { response: errorResponse('Forbidden', 403) };
  }

  const membership = await verifyLeagueMembership(leagueId, authenticatedUserId);
  if (!membership.isMember) {
    return { response: errorResponse('User is not a member of this league', 403) };
  }

  return { userId: authenticatedUserId };
}

async function validateDropPlayerAction(
  details: Record<string, unknown>,
  leagueId: string,
  memberId: string
): Promise<{ valid: boolean; error?: string }> {
  if (!details.playerId) {
    return { valid: false, error: 'Player ID is required' };
  }

  const ownership = await prisma.leagueRosterPlayer.findFirst({
    where: {
      leagueId,
      memberId,
      playerId: String(details.playerId),
    },
    select: { playerId: true },
  });

  if (!ownership) {
    return { valid: false, error: 'Player is not in your roster' };
  }

  return { valid: true };
}

/**
 * Runs after the drop and its waiver hold have committed. Projections are best effort: a failure
 * is logged and never changes or undoes the committed drop.
 */
async function projectCommittedDrop(drop: {
  actionId: string;
  leagueId: string;
  memberId: string;
  playerId: string;
}): Promise<void> {
  try {
    const { actionId, leagueId, memberId, playerId } = drop;

    await new WaiverAvailabilityProjectionService().projectLeague({ leagueId });

    logger.info('Processed drop player action into pending waiver hold', {
      actionId,
      leagueId,
      memberId,
      playerId,
    });
  } catch (error) {
    logger.warn('Drop committed but its availability projection failed', {
      actionId: drop.actionId,
      leagueId: drop.leagueId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
