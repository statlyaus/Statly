import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { updatePreDraftQueue, getPreDraftQueue } from '@/lib/draftLobby';
import { prisma } from '@/lib/prisma';
import { getUserIdFromRequest } from '@/lib/serverAuth';
import { z } from 'zod';
import type { DraftParams } from '@/types/api';

/**
 * Get member's pre-draft queue
 */
export async function GET(request: NextRequest, { params }: DraftParams) {
  const { id: draftId } = params;
  try {
    const memberId = request.nextUrl.searchParams.get('memberId');

    if (!memberId) {
      return errorResponse('Missing memberId parameter', 400);
    }

    const reqUserId = await getUserIdFromRequest(request);
    if (!reqUserId) {
      return errorResponse('Unauthorized', 401);
    }

    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        league: { include: { members: { where: { id: memberId } } } },
      },
    });
    if (!draft) {
      return errorResponse('Draft not found', 404);
    }
    const member = draft.league?.members?.[0];
    if (!member || member.userId !== reqUserId) {
      return errorResponse('Forbidden', 403);
    }

    const queue = await getPreDraftQueue(draftId, memberId);

    return successResponse({ queue });
  } catch (error) {
    logger.error('Failed to get pre-draft queue', error instanceof Error ? error : undefined, {
      draftId,
    });

    return errorResponse('Failed to get pre-draft queue', 500);
  }
}

/**
 * Update member's pre-draft queue
 */
export async function PUT(request: NextRequest, { params }: DraftParams) {
  const { id: draftId } = params;
  try {
    const raw = await request.json();
    const BodySchema = z.object({
      memberId: z.string().min(1),
      queue: z.array(
        z.object({
          playerId: z.string().min(1),
          rank: z.number().int().min(1),
          notes: z.string().optional(),
        })
      ),
    });
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return errorResponse('Invalid body', 400);
    }
    const { memberId, queue } = parsed.data;

    const reqUserId = await getUserIdFromRequest(request);
    if (!reqUserId) {
      return errorResponse('Unauthorized', 401);
    }

    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        league: { include: { members: { where: { id: memberId } } } },
      },
    });
    if (!draft) {
      return errorResponse('Draft not found', 404);
    }
    const member = draft.league?.members?.[0];
    if (!member || member.userId !== reqUserId) {
      return errorResponse('Forbidden', 403);
    }

    const seenIds = new Set<string>();
    const seenRanks = new Set<number>();
    for (const item of queue) {
      if (seenIds.has(item.playerId) || seenRanks.has(item.rank)) {
        return errorResponse('Duplicate playerId or rank in queue', 400);
      }
      seenIds.add(item.playerId);
      seenRanks.add(item.rank);
    }

    const updatedQueue = await updatePreDraftQueue(draftId, memberId, queue);

    return successResponse({ queue: updatedQueue });
  } catch (error) {
    logger.error('Failed to update pre-draft queue', error instanceof Error ? error : undefined, {
      draftId,
    });

    return errorResponse('Failed to update pre-draft queue', 500);
  }
}
