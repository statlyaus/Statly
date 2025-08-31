import type { NextRequest } from 'next/server';
import { successResponse, errorResponse, commonErrors } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

interface QueueRequest {
  playerId: string;
  memberId: string;
  rank?: number;
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let draftId: string | undefined;
  try {
    ({ id: draftId } = params);
    if (typeof draftId !== 'string' || draftId.trim().length === 0) {
      return errorResponse('Missing or invalid draftId', 400);
    }
    const body: QueueRequest = await request.json();
    const { playerId, memberId, rank } = body;

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

    // Add to queue
    const queueItem = await prisma.queueItem.create({
      data: {
        memberId,
        playerId,
        rank: rank || 1,
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
    logger.error('Failed to add player to queue', error, { draftId });
    return errorResponse('Failed to add player to queue', 500);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  let draftId: string | undefined;
  try {
    ({ id: draftId } = params);
    const url = new URL(request.url);
    const playerId = url.searchParams.get('playerId');
    const memberId = url.searchParams.get('memberId');

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
    logger.error('Failed to remove player from queue', error, { draftId });
    return errorResponse('Failed to remove player from queue', 500);
  }
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  let draftId: string | undefined;
  try {
    ({ id: draftId } = params);
    if (typeof draftId !== 'string' || draftId.trim().length === 0) {
      return errorResponse('Missing or invalid draftId', 400);
    }
    const url = new URL(request.url);
    const memberId = url.searchParams.get('memberId');

    if (!memberId) {
      return commonErrors.badRequest('Missing memberId');
    }

    // Get member's queue
    const queueItems = await prisma.queueItem.findMany({
      where: { memberId },
      orderBy: { rank: 'asc' },
    });

    // Get player details for each queue item
    const queueWithPlayers = await Promise.all(
      queueItems.map(async (item) => {
        const player = await prisma.player.findUnique({
          where: { id: item.playerId },
        });
        return {
          ...item,
          player,
        };
      })
    );

    logger.info('Queue retrieved', {
      draftId,
      memberId,
      queueSize: queueWithPlayers.length,
    });

    return successResponse(queueWithPlayers);
  } catch (error) {
    logger.error('Failed to get queue', error, { draftId });
    return errorResponse('Failed to get queue', 500);
  }
}
