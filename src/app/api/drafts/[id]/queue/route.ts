import type { NextRequest } from 'next/server';
import { successResponse, errorResponse, commonErrors } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getUserIdFromRequest } from '@/lib/serverAuth';
import type { LeagueParams } from '@/types/api';

interface QueueRequest {
  playerId: string;
  memberId: string;
  rank?: number;
}

/**
 * Validates and normalizes the draft ID from params
 * @param params - The params object containing the draft ID
 * @returns The normalized draft ID
 * @throws Error if validation fails
 */
async function validateDraftId(params: Promise<{ id: string }>): Promise<string> {
  const { id: draftId } = await params;
  
  if (typeof draftId !== 'string' || draftId.trim().length === 0) {
    throw new TypeError('Missing or invalid draftId');
  }
  
  return draftId.trim();
}

export async function POST(request: NextRequest, { params }: LeagueParams) {
  let draftId: string | undefined;
  let memberId: string | undefined;
  let playerId: string | undefined;
  try {
    // Authenticate user
    const reqUserId = await getUserIdFromRequest(request);
    if (!reqUserId) {
      return errorResponse('Unauthorized', 401);
    }

    // Validate draft ID
    try {
      draftId = await validateDraftId(params);
    } catch {
      return errorResponse('Missing or invalid draftId', 400);
    }

    const body: QueueRequest = await request.json();
    ({ playerId, memberId, rank } = body);

    if (!playerId || !memberId) {
      return commonErrors.badRequest('Missing playerId or memberId');
    }

    // Verify draft exists and member is part of it
    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        league: {
          include: {
            members: {
              where: { id: memberId },
            },
          },
        },
        picks: {
          where: { playerId },
        },
      },
    });

    if (!draft) {
      return commonErrors.notFound('Draft not found');
    }

    if (draft.league?.members.length === 0) {
      return commonErrors.forbidden('Not a member of this draft');
    }

    // Verify ownership - user can only modify their own queue
    const member = draft.league.members[0];
    if (member.userId !== reqUserId) {
      return commonErrors.forbidden('You can only modify your own queue');
    }

    // Check if player is already picked
    if (draft.picks.length > 0) {
      return commonErrors.badRequest('Player already picked');
    }

    // Verify player exists and is active
    const player = await prisma.player.findUnique({
      where: { id: playerId },
    });

    if (!player || !player.active) {
      return commonErrors.badRequest('Player not found or not available');
    }

    // Check if already queued
    const existingQueue = await prisma.queueItem.findFirst({
      where: {
        memberId,
        playerId,
      },
    });

    if (existingQueue) {
      return commonErrors.badRequest('Player already in queue');
    }

    // Determine rank - if omitted, set to next available
    let finalRank = rank;
    if (!finalRank) {
      const maxRank = await prisma.queueItem.findFirst({
        where: { memberId },
        orderBy: { rank: 'desc' },
        select: { rank: true },
      });
      finalRank = (maxRank?.rank || 0) + 1;
    }

    // Add to queue
    const queueItem = await prisma.queueItem.create({
      data: {
        memberId,
        playerId,
        rank: finalRank,
      },
    });

    logger.info('Player added to queue', {
      draftId,
      memberId,
      playerId,
      playerName: player.name,
      rank: queueItem.rank,
    });

    return successResponse(queueItem);
  } catch (error) {
    logger.error(
      'Failed to add player to queue',
      error instanceof Error ? error : undefined,
      {
        draftId,
        memberId,
        playerId,
      }
    );

    return errorResponse('Failed to add player to queue', 500);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: LeagueParams
) {
  let draftId: string | undefined;
  let memberId: string | undefined;
  let playerId: string | undefined;
  try {
    // Authenticate user
    const reqUserId = await getUserIdFromRequest(request);
    if (!reqUserId) {
      return errorResponse('Unauthorized', 401);
    }

    // Validate draft ID
    try {
      draftId = await validateDraftId(params);
    } catch {
      return errorResponse('Missing or invalid draftId', 400);
    }
    const url = new URL(request.url);
    playerId = url.searchParams.get('playerId') || undefined;
    memberId = url.searchParams.get('memberId') || undefined;

    if (!playerId || !memberId) {
      return commonErrors.badRequest('Missing playerId or memberId');
    }

    // Verify draft exists and member is part of it
    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        league: {
          include: {
            members: {
              where: { id: memberId },
            },
          },
        },
      },
    });

    if (!draft) {
      return commonErrors.notFound('Draft not found');
    }

    if (draft.league?.members.length === 0) {
      return commonErrors.forbidden('Not a member of this draft');
    }

    // Verify ownership - user can only modify their own queue
    const member = draft.league.members[0];
    if (member.userId !== reqUserId) {
      return commonErrors.forbidden('You can only modify your own queue');
    }

    // Find and delete queue item
    const queueItem = await prisma.queueItem.findFirst({
      where: {
        memberId,
        playerId,
      },
    });

    if (!queueItem) {
      return commonErrors.notFound('Player not in queue');
    }

    await prisma.queueItem.delete({
      where: { id: queueItem.id },
    });

    logger.info('Player removed from queue', {
      draftId,
      memberId,
      playerId,
    });

    return successResponse({ message: 'Player removed from queue' });
  } catch (error) {
    logger.error(
      'Failed to remove player from queue',
      error instanceof Error ? error : undefined,
      {
        draftId,
        memberId,
        playerId,
      }
    );

    return errorResponse('Failed to remove player from queue', 500);
  }
}

export async function GET(request: NextRequest, { params }: LeagueParams) {
  let draftId: string | undefined;
  let memberId: string | undefined;
  try {
    // Authenticate user
    const reqUserId = await getUserIdFromRequest(request);
    if (!reqUserId) {
      return errorResponse('Unauthorized', 401);
    }

    // Validate draft ID
    try {
      draftId = await validateDraftId(params);
    } catch {
      return errorResponse('Missing or invalid draftId', 400);
    }

    const url = new URL(request.url);
    memberId = url.searchParams.get('memberId') || undefined;

    if (!memberId) {
      return commonErrors.badRequest('Missing memberId');
    }

    // Verify draft exists and member is part of it
    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        league: {
          include: {
            members: {
              where: { id: memberId },
            },
          },
        },
      },
    });

    if (!draft) {
      return commonErrors.notFound('Draft not found');
    }

    if (draft.league?.members.length === 0) {
      return commonErrors.forbidden('Not a member of this draft');
    }

    // Verify ownership - user can only view their own queue
    if (!draft.league?.members?.[0]) {
      return commonErrors.forbidden('Member not found in this draft');
    }
    
    const member = draft.league.members[0];
    if (member.userId !== reqUserId) {
      return commonErrors.forbidden('You can only view your own queue');
    }

    // Get member's queue
    const queueItems = await prisma.queueItem.findMany({
      where: { memberId },
      orderBy: { rank: 'asc' },
    });

    // Get player details for all queue items in a single query to avoid N+1
    const playerIds = queueItems.map(item => item.playerId);
    const players = await prisma.player.findMany({
      where: { id: { in: playerIds } },
      select: {
        id: true,
        name: true,
        position: true,
        club: true,
        active: true,
      },
    });

    // Map players to queue items
    const playerMap = new Map(players.map(player => [player.id, player]));
    const queueWithPlayers = queueItems.map(item => ({
      ...item,
      player: playerMap.get(item.playerId),
    }));

    logger.info('Queue retrieved', {
      draftId,
      memberId,
      queueSize: queueWithPlayers.length,
    });

    return successResponse(queueWithPlayers);
  } catch (error) {
    logger.error(
      'Failed to get queue',
      error instanceof Error ? error : undefined,
      {
        draftId,
        memberId,
      }
    );

    return errorResponse('Failed to get queue', 500);
  }
}
