import type { NextRequest } from 'next/server';
import { successResponse, errorResponse, commonErrors } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import {
  DraftPrivateStateAccessError,
  draftPrivateStateService,
} from '@/server/draft/services/DraftPrivateStateService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PreQueueRequest {
  queue: Array<{
    playerId: string;
    rank: number;
    notes?: string;
  }>;
}

async function authenticate(request: NextRequest): Promise<string | Response> {
  const actorUserId = await getAuthenticatedUserId(request);
  if (!actorUserId) {
    return commonErrors.unauthorized('Authentication required');
  }

  return actorUserId;
}

function privateResponse(data: unknown): Response {
  const response = successResponse(data);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

function privateStateErrorResponse(error: unknown, operation: string, draftId: string): Response {
  if (error instanceof DraftPrivateStateAccessError) {
    return commonErrors.forbidden(error.message);
  }

  logger.error(`Failed to ${operation}`, {
    draftId,
    error: error instanceof Error ? error.message : String(error),
  });
  return errorResponse(`Failed to ${operation}`, 500);
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
    const actorUserId = await authenticate(request);
    if (actorUserId instanceof Response) {
      return actorUserId;
    }

    const queue = await draftPrivateStateService.getPreDraftQueue({ draftId, actorUserId });

    return privateResponse({ queue });
  } catch (error) {
    return privateStateErrorResponse(error, 'get pre-draft queue', (await params).id);
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
    const actorUserId = await authenticate(request);
    if (actorUserId instanceof Response) {
      return actorUserId;
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

    const updatedQueue = await draftPrivateStateService.replacePreDraftQueue({
      draftId,
      actorUserId,
      queue: body.queue,
    });

    return privateResponse({ queue: updatedQueue });
  } catch (error) {
    return privateStateErrorResponse(error, 'update pre-draft queue', (await params).id);
  }
}
