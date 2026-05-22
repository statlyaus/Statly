import type { NextRequest } from 'next/server';

import { z } from 'zod';

import { successResponse, errorResponse, commonErrors } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { getUserIdFromRequest } from '@/lib/serverAuth';
import { draftApplicationService } from '@/server/draft/services/DraftApplicationService';
import { draftRealtimePublisher } from '@/server/draft/services/DraftRealtimePublisher';

export async function handlePickCommand(request: NextRequest, params: Promise<{ id: string }>) {
  const requestContext: { draftId?: string; userId?: string; hasSessionCookie?: boolean } = {};
  const headerRequestId =
    request.headers.get('x-request-id') ?? request.headers.get('x-requestid') ?? undefined;
  const headerCorrelationId = request.headers.get('x-correlation-id') ?? undefined;

  try {
    const { id: draftId } = await params;
    if (typeof draftId !== 'string' || draftId.trim().length === 0) {
      return errorResponse('Missing or invalid draftId', 400);
    }
    requestContext.draftId = draftId;

    let userId = await getUserIdFromRequest(request);
    requestContext.hasSessionCookie = Boolean(request.cookies.get('statly_session')?.value);

    if (!userId && process.env.NODE_ENV !== 'production') {
      const devUser = request.headers.get('x-dev-user-id');
      if (devUser) {
        userId = devUser;
      }
    }

    if (!userId) {
      logger.warn('Draft pick request failed (unauthorized)', {
        method: request.method,
        url: request.url,
        draftId: requestContext.draftId,
        requestId: headerRequestId,
        correlationId: headerCorrelationId,
        kind: 'unauthorized',
        detail: 'Missing or invalid authentication',
      });
      return errorResponse('Unauthorized', 401);
    }

    requestContext.userId = userId;

    const body = await request.json();
    const schema = z.object({
      playerId: z.string().min(1),
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return commonErrors.badRequest('Invalid request body');
    }

    const devOverrideUserId =
      process.env.NODE_ENV !== 'production'
        ? request.headers.get('x-dev-user-id') || undefined
        : undefined;
    const effectiveUserId = devOverrideUserId || userId;

    const result = await draftApplicationService.makePick({
      draftId,
      actorUserId: effectiveUserId,
      playerId: parsed.data.playerId,
    });

    try {
      await draftRealtimePublisher.publishCommandResult(result);
    } catch (publishError) {
      logger.warn('Failed to publish draft pick side effects', {
        draftId: requestContext.draftId,
        error: publishError,
      });
    }

    const eventPick = result.data.eventPick ?? null;
    if (!eventPick) {
      logger.error('Draft pick command completed without an eventPick payload', {
        draftId: requestContext.draftId,
        userId: requestContext.userId,
        idempotent: Boolean(result.data.idempotent),
      });
      return errorResponse('Failed to make pick', 500);
    }

    return successResponse({
      pick: eventPick,
      currentPick: result.currentPick,
      isComplete: result.isComplete,
      nextTurn: result.isComplete ? null : undefined,
      idempotent: Boolean(result.data.idempotent),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const [kind, detail] = msg.includes(':') ? msg.split(':', 2) : ['internal', msg];

    const logBase = {
      method: request.method,
      url: request.url,
      draftId: requestContext.draftId,
      userId: requestContext.userId,
      hasSessionCookie: requestContext.hasSessionCookie,
      requestId: headerRequestId,
      correlationId: headerCorrelationId,
      kind,
      detail,
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: msg,
        stack: error instanceof Error ? error.stack : undefined,
      },
    } as const;

    if (kind === 'not_found') {
      logger.warn('Draft pick request failed (not_found)', logBase);
      return commonErrors.notFound(detail);
    }
    if (kind === 'bad_request') {
      logger.warn('Draft pick request failed (bad_request)', logBase);
      return commonErrors.badRequest(detail);
    }
    if (kind === 'conflict') {
      logger.warn('Draft pick request failed (conflict)', logBase);
      return errorResponse(detail || 'Draft state changed', 409);
    }
    if (kind === 'forbidden') {
      logger.warn('Draft pick request failed (forbidden)', logBase);
      return errorResponse(detail || 'Forbidden', 403);
    }

    logger.error('Failed to make pick', logBase);
    return errorResponse('Failed to make pick', 500);
  }
}
