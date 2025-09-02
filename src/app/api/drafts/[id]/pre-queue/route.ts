import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { updatePreDraftQueue, getPreDraftQueue } from '@/lib/draftLobby';

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
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: draftId } = await params;
    const url = new URL(request.url);
    const memberId = url.searchParams.get('memberId');

    if (!memberId) {
      return errorResponse('Missing memberId parameter', 400);
    }

    const queue = await getPreDraftQueue(draftId, memberId);

    return successResponse({ queue });
  } catch (error) {
    logger.error('Failed to get pre-draft queue', {
      draftId: (await params).id,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse('Failed to get pre-draft queue', 500);
  }
}

/**
 * Update member's pre-draft queue
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: draftId } = await params;
    const body: PreQueueRequest = await request.json();

    if (!body.memberId || !Array.isArray(body.queue)) {
      return errorResponse('Missing memberId or invalid queue format', 400);
    }

    // Validate queue items
    for (const item of body.queue) {
      if (!item.playerId || typeof item.rank !== 'number') {
        return errorResponse('Invalid queue item format', 400);
      }
    }

    const updatedQueue = await updatePreDraftQueue(draftId, body.memberId, body.queue);

    return successResponse({ queue: updatedQueue });
  } catch (error) {
    logger.error('Failed to update pre-draft queue', {
      draftId: (await params).id,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse('Failed to update pre-draft queue', 500);
  }
}
