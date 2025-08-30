import type { NextRequest } from 'next/server';
import { successResponse, errorResponse, commonErrors } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

interface QueueRequest {
  playerId: string;
  memberId: string;
  rank?: number;
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id: draftId } = params;
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
    logger.error('Failed to add player to queue', {
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });

    return errorResponse('Failed to add player to queue', 500);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: draftId } = await params;
    const url = new URL(request.url);
    
    // Validate query parameters with Zod
    const querySchema = z.object({
      playerId: z.string().min(1),
      memberId: z.string().min(1),
    });
    
    const queryParams = {
      playerId: url.searchParams.get('playerId'),
      memberId: url.searchParams.get('memberId'),
    };
    
    const validation = querySchema.safeParse(queryParams);
    if (!validation.success) {
      return commonErrors.unprocessableEntity(validation.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', '));
    }
    
    const { playerId, memberId } = validation.data;

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
    logger.error('Failed to remove player from queue', {
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });

    return errorResponse('Failed to remove player from queue', 500);
  }
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
  const { id: draftId } = params;
  if (typeof draftId !== 'string' || draftId.trim().length === 0) {
    return errorResponse('Missing or invalid draftId', 400);
  }
    const url = new URL(request.url);
    
    // Validate query parameters with Zod
    const querySchema = z.object({
      memberId: z.string().min(1),
    });
    
    const queryParams = {
      memberId: url.searchParams.get('memberId'),
    };
    
    const validation = querySchema.safeParse(queryParams);
    if (!validation.success) {
      return commonErrors.unprocessableEntity(validation.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', '));
    }
    
    const { memberId } = validation.data;

    // Get member's queue with restricted fields
    const queueItems = await prisma.queueItem.findMany({
      where: { memberId },
      select: {
        id: true,
        memberId: true,
        playerId: true,
        rank: true,
      },
      orderBy: { rank: 'asc' },
    });

    // Get player details with restricted fields
    const playerIds = queueItems.map(item => item.playerId);
    const players = await prisma.player.findMany({
      where: { id: { in: playerIds } },
      select: {
        id: true,
        name: true,
        position: true,
        club: true,
      },
    });
    
    // Create player map for efficient lookup
    const playerMap = new Map(players.map(p => [p.id, p]));
    
    // Build queue with players using restricted data
    const queueWithPlayers = queueItems.map(item => ({
      ...item,
      player: playerMap.get(item.playerId) || null,
    }));

    logger.info('Queue retrieved', {
      draftId,
      memberId,
      queueSize: queueWithPlayers.length,
    });

    return successResponse(queueWithPlayers);
  } catch (error) {
    logger.error('Failed to get queue', {
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });

    return errorResponse('Failed to get queue', 500);
  }
}
