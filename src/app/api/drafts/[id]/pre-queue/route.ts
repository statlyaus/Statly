import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { successResponse, errorResponse, commonErrors } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import {
  DraftPrivateStateAccessError,
  DraftPrivateStateConflictError,
  DraftPrivateStateValidationError,
  draftPrivateStateService,
} from '@/server/draft/services/DraftPrivateStateService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PreQueueRequestSchema = z.object({
  queue: z.array(
    z.object({
      playerId: z.string().trim().min(1),
      rank: z.coerce.number().int().positive(),
      notes: z.string().optional(),
    })
  ),
});

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
  if (error instanceof DraftPrivateStateValidationError) {
    return commonErrors.badRequest(error.message);
  }
  if (error instanceof DraftPrivateStateConflictError) {
    return errorResponse(error.message, 409, 'CONFLICT');
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

    const parsed = PreQueueRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return commonErrors.unprocessableEntity('Invalid queue format', {
        issues: parsed.error.flatten(),
      });
    }

    const result = await draftPrivateStateService.replacePreDraftQueue({
      draftId,
      actorUserId,
      unresolvedPlayerPolicy: 'reject',
      queue: parsed.data.queue,
    });

    return privateResponse(result);
  } catch (error) {
    return privateStateErrorResponse(error, 'update pre-draft queue', (await params).id);
  }
}
