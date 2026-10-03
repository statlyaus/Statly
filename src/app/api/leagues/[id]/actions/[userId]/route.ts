import type { TeamActionType } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { tags } from '@/lib/cacheTags';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { verifyLeagueMembership } from '@/lib/leagueMembership';
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
      where: { leagueId, memberId: member.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const formattedActions = actions.map((action) => ({
      id: action.id,
      actionType: action.actionType,
      status: action.status,
      details: JSON.parse(action.details || '{}'),
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

    const { actionType, details, targetMemberId } = body;

    if (!actionType || !details) {
      return errorResponse('Action type and details are required', 400);
    }
    if (typeof details !== 'object' || Array.isArray(details)) {
      return errorResponse('Action details must be an object', 400);
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

    // Validate action based on type
    const validationResult = await validateTeamAction(
      actionType,
      canonicalDetails,
      leagueId,
      member.id,
      targetMemberId
    );
    if (!validationResult.valid) {
      return errorResponse(validationResult.error || 'Invalid action', 400);
    }

    // Calculate processing time based on action type
    let processingAt: Date | null = null;
    if (actionType === 'WAIVER_CLAIM') {
      // Waivers process at next waiver period (typically daily)
      processingAt = new Date();
      processingAt.setHours(23, 59, 59, 999); // End of day
    } else if (actionType === 'DROP_PLAYER') {
      // Dropped players leave the roster now, then stay on waivers before free agency.
      processingAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    } else if (actionType === 'TRADE_PROPOSAL') {
      // Trades can be processed immediately if no review period
      processingAt = new Date();
    }

    const actionId = `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    // validateTeamAction above accepts only TeamActionType values.
    await prisma.teamAction.create({
      data: {
        id: actionId,
        leagueId,
        memberId: member.id,
        actionType: actionType as TeamActionType,
        details: JSON.stringify(canonicalDetails),
        targetMemberId,
        processingAt,
      },
    });

    const action = {
      id: actionId,
      leagueId,
      memberId: member.id,
      actionType,
      details: JSON.stringify(canonicalDetails),
      targetMemberId,
      processingAt,
      createdAt: new Date(),
      status: 'PENDING',
    };

    // Process immediate actions
    if (actionType === 'DROP_PLAYER') {
      await processDropPlayerAction(action.id);
    }

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
        details: JSON.parse(action.details),
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

// Validation logic for different action types
async function validateTeamAction(
  actionType: string,
  details: Record<string, unknown>,
  leagueId: string,
  memberId: string,
  targetMemberId?: string
): Promise<{ valid: boolean; error?: string }> {
  switch (actionType) {
    case 'TRADE_PROPOSAL': {
      if (!details.offeredPlayers || !details.requestedPlayers || !targetMemberId) {
        return {
          valid: false,
          error: 'Trade must include offered players, requested players, and target member',
        };
      }

      // Additional trade validation would go here
      return { valid: true };
    }

    case 'WAIVER_CLAIM': {
      if (!details.playerId || !details.dropPlayerId) {
        return {
          valid: false,
          error: 'Waiver claim must include player to claim and player to drop',
        };
      }

      // Additional waiver validation would go here
      return { valid: true };
    }

    case 'DROP_PLAYER': {
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

    default:
      return { valid: false, error: 'Unknown action type' };
  }
}

async function processDropPlayerAction(actionId: string): Promise<void> {
  try {
    const action = await prisma.teamAction.findUnique({ where: { id: actionId } });
    if (!action || action.status !== 'PENDING' || action.actionType !== 'DROP_PLAYER') {
      return;
    }

    const details = JSON.parse(action.details || '{}');
    const playerId = typeof details.playerId === 'string' ? details.playerId : null;
    if (!playerId) {
      throw new Error('Drop action missing playerId');
    }

    const { leagueId, memberId } = action;

    await prisma.$transaction(async (tx) => {
      const roster = await tx.leagueRoster.findUnique({
        where: { leagueId_memberId: { leagueId, memberId } },
        select: { playerIds: true },
      });

      const playerIds = parsePlayerIds(roster?.playerIds);
      const nextPlayerIds = playerIds.filter((id) => id !== playerId);

      await tx.leagueRosterPlayer.deleteMany({
        where: { leagueId, memberId, playerId },
      });

      if (roster) {
        await tx.leagueRoster.update({
          where: { leagueId_memberId: { leagueId, memberId } },
          data: { playerIds: JSON.stringify(nextPlayerIds) },
        });
      }
    });

    await new WaiverAvailabilityProjectionService().projectLeague({ leagueId });

    await Promise.allSettled([
      revalidateTag(tags.league(leagueId), { expire: 0 }),
      revalidateTag(tags.waivers(leagueId), { expire: 0 }),
    ]);

    logger.info('Processed drop player action into pending waiver hold', {
      actionId,
      leagueId,
      memberId,
      playerId,
    });
  } catch (error) {
    logger.error('Failed to process drop player action', {
      actionId,
      error: error instanceof Error ? error.message : String(error),
    });

    await prisma.teamAction.update({
      where: { id: actionId },
      data: { status: 'REJECTED', processedAt: new Date() },
    });
  }
}

function parsePlayerIds(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw || '[]'));
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
