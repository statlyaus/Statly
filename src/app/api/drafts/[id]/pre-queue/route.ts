import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { updatePreDraftQueue, getPreDraftQueue } from '@/lib/draftLobby';
import { prisma } from '@/lib/prisma';
import { getUserIdFromRequest } from '@/lib/serverAuth';

interface PreQueueRequest {
  memberId: string;
  queue: Array<{
    playerId: string;
    rank: number;
    notes?: string;
  }>;
}

/**
 * Get member's pre-draft queue
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id: draftId } = params;
  try {
    const reqUserId = await getUserIdFromRequest(request);
    if (!reqUserId) return errorResponse('Unauthorized', 401);

    const url = new URL(request.url);
    const memberId = url.searchParams.get('memberId');
    if (!memberId) {
      return errorResponse('Missing memberId parameter', 400);
    }

    const member = await prisma.leagueMember.findUnique({
      where: { id: memberId },
      select: { userId: true },
    });
    if (!member || member.userId !== reqUserId) {
      return errorResponse('Forbidden', 403);
    }

    const queue = await getPreDraftQueue(draftId, memberId);

    return successResponse({ queue });
  } catch (error) {
    logger.error('Failed to get pre-draft queue', {
      draftId,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse('Failed to get pre-draft queue', 500);
  }
}

/**
 * Update member's pre-draft queue
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id: draftId } = params;
  try {
    const reqUserId = await getUserIdFromRequest(request);
    if (!reqUserId) return errorResponse('Unauthorized', 401);

    const body: PreQueueRequest = await request.json();
    if (!body.memberId || !Array.isArray(body.queue)) {
      return errorResponse('Missing memberId or invalid queue format', 400);
    }

    const member = await prisma.leagueMember.findUnique({
      where: { id: body.memberId },
      select: { userId: true },
    });
    if (!member || member.userId !== reqUserId) {
      return errorResponse('Forbidden', 403);
    }

    const seenIds = new Set<string>();
    const seenRanks = new Set<number>();
    for (const item of body.queue) {
      if (!item.playerId || !Number.isInteger(item.rank) || item.rank < 1) {
        return errorResponse('Invalid queue item format', 400);
      }
      if (seenIds.has(item.playerId) || seenRanks.has(item.rank)) {
        return errorResponse('Duplicate playerId or rank in queue', 400);
      }
      seenIds.add(item.playerId);
      seenRanks.add(item.rank);
    }

    const updatedQueue = await updatePreDraftQueue(draftId, body.memberId, body.queue);

    return successResponse({ queue: updatedQueue });
  } catch (error) {
    logger.error('Failed to update pre-draft queue', {
      draftId,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse('Failed to update pre-draft queue', 500);
  }
}
