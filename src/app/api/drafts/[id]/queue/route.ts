import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { commonErrors, errorResponse, successResponse } from '@/lib/apiResponse';
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

const QueuePostSchema = z.object({
  playerId: z.string().trim().min(1),
  rank: z.coerce.number().int().positive().optional(),
});

const QueueDeleteQuerySchema = z.object({
  playerId: z.string().trim().min(1),
});

const QueuePutSchema = z.object({
  queue: z.array(z.string().trim().min(1)).default([]),
});

async function authenticate(request: NextRequest): Promise<string | Response> {
  const actorUserId = await getAuthenticatedUserId(request);
  if (!actorUserId) {
    return commonErrors.unauthorized('Authentication required');
  }

  return actorUserId;
}

function isInvalidDraftId(draftId: string): boolean {
  return typeof draftId !== 'string' || draftId.trim().length === 0;
}

function privateResponse(data: unknown, status = 200): Response {
  const response = successResponse(data, status);
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id: draftId } = await params;
  try {
    if (isInvalidDraftId(draftId)) {
      return commonErrors.badRequest('Missing or invalid draftId');
    }

    const actorUserId = await authenticate(request);
    if (actorUserId instanceof Response) return actorUserId;

    const parsed = QueuePostSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return commonErrors.unprocessableEntity('Invalid request body', {
        issues: parsed.error.flatten(),
      });
    }

    const entry = await draftPrivateStateService.addToPreDraftQueue({
      draftId,
      actorUserId,
      ...parsed.data,
    });

    return privateResponse(entry, 201);
  } catch (error) {
    return privateStateErrorResponse(error, 'add player to queue', draftId);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id: draftId } = await params;
  try {
    if (isInvalidDraftId(draftId)) {
      return commonErrors.badRequest('Missing or invalid draftId');
    }

    const actorUserId = await authenticate(request);
    if (actorUserId instanceof Response) return actorUserId;

    const url = new URL(request.url);
    const parsed = QueueDeleteQuerySchema.safeParse({
      playerId: url.searchParams.get('playerId'),
    });
    if (!parsed.success) {
      return commonErrors.unprocessableEntity('Invalid query params', {
        issues: parsed.error.flatten(),
      });
    }

    const removed = await draftPrivateStateService.removeFromPreDraftQueue({
      draftId,
      actorUserId,
      playerId: parsed.data.playerId,
    });
    if (!removed) {
      return commonErrors.notFound('Player not in queue');
    }

    return privateResponse({ message: 'Player removed from queue' });
  } catch (error) {
    return privateStateErrorResponse(error, 'remove player from queue', draftId);
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id: draftId } = await params;
  try {
    if (isInvalidDraftId(draftId)) {
      return commonErrors.badRequest('Missing or invalid draftId');
    }

    const actorUserId = await authenticate(request);
    if (actorUserId instanceof Response) return actorUserId;

    const queue = await draftPrivateStateService.getPreDraftQueue({ draftId, actorUserId });
    return privateResponse(queue);
  } catch (error) {
    return privateStateErrorResponse(error, 'get queue', draftId);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id: draftId } = await params;
  try {
    if (isInvalidDraftId(draftId)) {
      return commonErrors.badRequest('Missing or invalid draftId');
    }

    const actorUserId = await authenticate(request);
    if (actorUserId instanceof Response) return actorUserId;

    const parsed = QueuePutSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return commonErrors.unprocessableEntity('Invalid request body', {
        issues: parsed.error.flatten(),
      });
    }

    const result = await draftPrivateStateService.replacePreDraftQueue({
      draftId,
      actorUserId,
      unresolvedPlayerPolicy: 'remove',
      queue: parsed.data.queue.map((playerId, index) => ({
        playerId,
        rank: index + 1,
      })),
    });

    return privateResponse({
      memberId: result.memberId,
      queue: result.queue,
      failedIds: result.removedPlayerIds,
    });
  } catch (error) {
    return privateStateErrorResponse(error, 'update queue', draftId);
  }
}
