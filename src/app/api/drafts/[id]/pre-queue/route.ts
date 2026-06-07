import type { NextRequest } from 'next/server';
import { successResponse, errorResponse, commonErrors } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { updatePreDraftQueue, getPreDraftQueue } from '@/lib/draftLobby';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { getDraftMembershipAccess } from '@/server/leagues/membership';

interface PreQueueRequest {
  queue: Array<{
    playerId: string;
    rank: number;
    notes?: string;
  }>;
}

async function resolvePreQueueMember(
  request: NextRequest,
  draftId: string
): Promise<{ memberId: string } | Response> {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return commonErrors.unauthorized('Authentication required');
  }

  const access = await getDraftMembershipAccess(draftId, userId);
  if (!access.isMember || !access.memberId) {
    return commonErrors.forbidden('League membership required');
  }

  return { memberId: access.memberId };
}

/**
 * Get member's pre-draft queue
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { id: draftId } = await params;
    const access = await resolvePreQueueMember(request, draftId);
    if (access instanceof Response) {
      return access;
    }

    const queue = await getPreDraftQueue(draftId, access.memberId);

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
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { id: draftId } = await params;
    const access = await resolvePreQueueMember(request, draftId);
    if (access instanceof Response) {
      return access;
    }

    const body = (await request.json().catch(() => null)) as PreQueueRequest | null;
    if (!body || !Array.isArray(body.queue)) {
      return errorResponse('Invalid queue format', 400);
    }

    // Validate queue items
    for (const item of body.queue) {
      if (!item.playerId || typeof item.rank !== 'number') {
        return errorResponse('Invalid queue item format', 400);
      }
    }

    const updatedQueue = await updatePreDraftQueue(draftId, access.memberId, body.queue);

    return successResponse({ queue: updatedQueue });
  } catch (error) {
    logger.error('Failed to update pre-draft queue', {
      draftId: (await params).id,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse('Failed to update pre-draft queue', 500);
  }
}
