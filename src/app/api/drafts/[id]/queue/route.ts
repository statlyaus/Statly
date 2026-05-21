import type { NextRequest } from 'next/server';

import { successResponse, errorResponse, commonErrors } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface QueueRequest {
  playerId: string;
  memberId: string;
  rank?: number;
}

function isBoundMember(
  draft: {
    league?: {
      members: Array<{ id: string; userId: string }>;
    } | null;
  },
  memberId: string,
  actorUserId: string
) {
  return (
    draft.league?.members.some(
      (member) => member.id === memberId && member.userId === actorUserId
    ) ?? false
  );
}

export async function POST(request: NextRequest, context: any) {
  try {
    const actorUserId = await getAuthenticatedUserId(request);
    if (!actorUserId) {
      return commonErrors.unauthorized();
    }

    const draftId = ((await context?.params)?.id ??
      (Array.isArray((await context?.params)?.id) ? (await context.params).id[0] : undefined)) as
      | string
      | undefined;
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
              where: { id: memberId, userId: actorUserId },
              select: { id: true, userId: true },
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

    if (!isBoundMember(draft, memberId, actorUserId)) {
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

    // Check if already queued (draft-scoped)
    const existingQueue = await prisma.preDraftQueue.findFirst({
      where: {
        draftId,
        memberId,
        playerId,
      },
    });

    if (existingQueue) {
      return commonErrors.badRequest('Player already in queue');
    }

    if (rank !== undefined && (!Number.isInteger(rank) || rank < 1)) {
      return commonErrors.badRequest('Rank must be a positive integer');
    }

    const queueItem = await prisma.$transaction(async (tx) => {
      const existingQueue = await tx.preDraftQueue.findMany({
        where: { draftId, memberId },
        orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, rank: true },
      });

      const targetRank =
        rank === undefined ? existingQueue.length + 1 : Math.min(rank, existingQueue.length + 1);

      for (const item of [...existingQueue]
        .filter((item) => item.rank >= targetRank)
        .sort((a, b) => b.rank - a.rank)) {
        await tx.preDraftQueue.update({
          where: { id: item.id },
          data: { rank: item.rank + 1 },
        });
      }

      return tx.preDraftQueue.create({
        data: {
          draftId,
          memberId,
          playerId,
          rank: targetRank,
        },
      });
    });

    logger.info('Player added to queue', {
      draftId,
      memberId,
      playerId,
      playerName: player.name,
      rank: queueItem.rank,
    });

    return successResponse({
      id: queueItem.id,
      memberId: queueItem.memberId,
      playerId: queueItem.playerId,
      rank: queueItem.rank,
    });
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

export async function DELETE(request: NextRequest, context: any) {
  try {
    const actorUserId = await getAuthenticatedUserId(request);
    if (!actorUserId) {
      return commonErrors.unauthorized();
    }

    const draftId = ((await context?.params)?.id ??
      (Array.isArray((await context?.params)?.id) ? (await context.params).id[0] : undefined)) as
      | string
      | undefined;
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
              where: { id: memberId, userId: actorUserId },
              select: { id: true, userId: true },
            },
          },
        },
      },
    });

    if (!draft) {
      return commonErrors.notFound('Draft not found');
    }

    if (!isBoundMember(draft, memberId, actorUserId)) {
      return commonErrors.forbidden('Not a member of this draft');
    }

    // Find and delete queue item (draft-scoped)
    const queueItem = await prisma.preDraftQueue.findFirst({
      where: {
        draftId,
        memberId,
        playerId,
      },
    });

    if (!queueItem) {
      return commonErrors.notFound('Player not in queue');
    }

    await prisma.preDraftQueue.delete({
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

export async function GET(request: NextRequest, context: any) {
  try {
    const actorUserId = await getAuthenticatedUserId(request);
    if (!actorUserId) {
      return commonErrors.unauthorized();
    }

    const draftId = ((await context?.params)?.id ??
      (Array.isArray((await context?.params)?.id) ? (await context.params).id[0] : undefined)) as
      | string
      | undefined;
    if (typeof draftId !== 'string' || draftId.trim().length === 0) {
      return errorResponse('Missing or invalid draftId', 400);
    }
    const url = new URL(request.url);
    const memberId = url.searchParams.get('memberId');

    if (!memberId) {
      return commonErrors.badRequest('Missing memberId');
    }

    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        league: {
          include: {
            members: {
              where: { id: memberId, userId: actorUserId },
              select: { id: true, userId: true },
            },
          },
        },
      },
    });

    if (!draft) {
      return commonErrors.notFound('Draft not found');
    }

    if (!isBoundMember(draft, memberId, actorUserId)) {
      return commonErrors.forbidden('Not a member of this draft');
    }

    // Get member's queue (draft-scoped) with players in one query
    const queueWithPlayers = await prisma.preDraftQueue.findMany({
      where: { draftId, memberId },
      orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
      include: { player: true },
    });

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
