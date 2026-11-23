import { NextResponse, type NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { inActiveSeason } from '@/server/leagues/activeSeason';
import {
  findBiteFreeze,
  holdsUnexecutedBite,
  LAST_PLAYER_BITE_HELD_MESSAGE,
} from '@/server/leagues/bitePending';
import {
  INTERACTIVE_LEAGUE_LOCK,
  LeagueBusyError,
  lockLeagueRowOrBusy,
} from '@/server/leagues/leagueRowLock';
import { describeLockedPlayers, findPlayersLockedForMove } from '@/server/leagues/playerMoveLock';
import { prisma } from '@/lib/prisma';
import {
  getTransactionWindow,
  transactionsClosedResponse,
} from '@/server/leagues/transactionWindow';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { verifyLeagueMembership } from '@/lib/leagueMembership';
import { resolveCanonicalPlayerIds } from '@/server/players/playerIdentityService';
import { dropRosterPlayerInTransaction } from '@/server/rosters/rosterDrop';
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

    // E10: during the Bloodsucker's exclusive window nobody else drops, so a dropped player cannot
    // become a free agent only the Bloodsucker can take.
    const transactionWindow = await getTransactionWindow(leagueId, prisma, { memberId: member.id });
    if (!transactionWindow.open && transactionWindow.code !== 'DRAFT_NOT_COMPLETE') {
      return transactionsClosedResponse(transactionWindow);
    }

    // The player must be on this member's roster in this league.
    const validationResult = await validateDropPlayerAction(canonicalDetails, leagueId, member.id);
    if (!validationResult.valid) {
      return errorResponse(validationResult.error || 'Invalid action', 400);
    }

    // Dropped players leave the roster now, then stay on waivers before free agency. The roster
    // delete and the waiver hold commit together, so a reported drop always has its hold.
    const playerId = String(canonicalDetails.playerId);

    // A player whose game has started this round stays until the round ends.
    const lock = await findPlayersLockedForMove({ leagueId, playerIds: [playerId] });
    if (!lock.ok) return errorResponse(lock.error, 503);
    if (lock.lockedPlayers.length > 0) {
      return errorResponse(describeLockedPlayers(lock.lockedPlayers), 409);
    }

    const dropped = await prisma.$transaction(async (tx) => {
      // BR-30, E12: a member with a Bloodsucker bite waiting, or whose matchup against the
      // Bloodsucker has ended and is not final, cannot drop. Checked under the League row lock the
      // grant and the bite take, so a drop never races a bite on the same roster.
      await lockLeagueRowOrBusy(tx, leagueId, INTERACTIVE_LEAGUE_LOCK.waitMs);
      const freeze = await findBiteFreeze(tx, leagueId, member.id);
      if (freeze) return freeze;
      // A Bloodsucker with a bite to make keeps one player to send back (#1343).
      if (
        (await holdsUnexecutedBite(tx, leagueId, member.id)) &&
        (await tx.leagueRosterPlayer.count({ where: { leagueId, memberId: member.id } })) <= 1
      ) {
        return 'LAST_PLAYER_BITE_HELD' as const;
      }
      return dropRosterPlayerInTransaction(tx, {
        leagueId,
        memberId: member.id,
        playerId,
        details: canonicalDetails,
      });
    }, INTERACTIVE_LEAGUE_LOCK.transaction);
    if (dropped === 'LAST_PLAYER_BITE_HELD') {
      return NextResponse.json(
        { error: LAST_PLAYER_BITE_HELD_MESSAGE, code: 'LAST_PLAYER_BITE_HELD' },
        { status: 409 }
      );
    }
    if (!dropped) {
      return errorResponse('Player is no longer in your roster', 409);
    }
    if (!('actionId' in dropped)) {
      // Same flat shape as the window refusal, so clients read one `code` field.
      return NextResponse.json({ error: dropped.message, code: dropped.code }, { status: 409 });
    }
    const { actionId, processingAt } = dropped;

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
    // Round scoring holds the League row while it runs: say so instead of a bare 500.
    if (error instanceof LeagueBusyError) {
      return errorResponse(error.message, error.status, error.code);
    }
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
