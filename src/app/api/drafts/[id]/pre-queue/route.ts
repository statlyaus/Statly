import type { NextRequest } from 'next/server';
import { successResponse, errorResponse, commonErrors } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { updatePreDraftQueue, getPreDraftQueue } from '@/lib/draftLobby';
import { prisma } from '@/lib/prisma';
import { getUserIdFromRequest } from '@/lib/serverAuth';
import type { DraftParams } from '@/types/api';

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
  { params }: DraftParams
) {
  const { id: draftId } = await params;
  try {
    const reqUserId = await getUserIdFromRequest(request);
    if (!reqUserId) {
      return commonErrors.unauthorized();
    }

    const url = new URL(request.url);
    const memberId = url.searchParams.get('memberId');

    if (!memberId) {
      return commonErrors.badRequest('Missing memberId parameter');
    }

    // Verify draft exists and member belongs to this draft
    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        league: {
          include: { members: { where: { id: memberId } } },
        },
      },
    });

    if (!draft) {
      return commonErrors.notFound('Draft not found');
    }

    const member = draft.league?.members[0];
    if (!member) {
      return commonErrors.forbidden('Not a member of this draft');
    }

    if (member.userId !== reqUserId) {
      return commonErrors.forbidden('Forbidden');
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
  { params }: DraftParams
) {
  const { id: draftId } = await params;
  try {
    const reqUserId = await getUserIdFromRequest(request);
    if (!reqUserId) {
      return commonErrors.unauthorized();
    }

    const body: PreQueueRequest = await request.json();

    if (!body.memberId || !Array.isArray(body.queue)) {
      return commonErrors.badRequest('Missing memberId or invalid queue format');
    }

    // Verify draft exists and member belongs to user
    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        league: {
          include: { members: { where: { id: body.memberId } } },
        },
      },
    });

    if (!draft) {
      return commonErrors.notFound('Draft not found');
    }

    const member = draft.league?.members[0];
    if (!member) {
      return commonErrors.forbidden('Not a member of this draft');
    }

    if (member.userId !== reqUserId) {
      return commonErrors.forbidden('Forbidden');
    }

    // Validate queue items
    const seenPlayers = new Set<string>();
    const seenRanks = new Set<number>();
    for (const item of body.queue) {
      if (
        !item.playerId ||
        typeof item.rank !== 'number' ||
        !Number.isInteger(item.rank) ||
        item.rank < 1
      ) {
        return commonErrors.badRequest('Invalid queue item format');
      }
      if (seenPlayers.has(item.playerId) || seenRanks.has(item.rank)) {
        return commonErrors.badRequest('Duplicate playerId or rank in queue');
      }
      seenPlayers.add(item.playerId);
      seenRanks.add(item.rank);
    }

    const updatedQueue = await updatePreDraftQueue(
      draftId,
      body.memberId,
      body.queue,
    );

    return successResponse({ queue: updatedQueue });
  } catch (error) {
    logger.error('Failed to update pre-draft queue', {
      draftId,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse('Failed to update pre-draft queue', 500);
  }
}
