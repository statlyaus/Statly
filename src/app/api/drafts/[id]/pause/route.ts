import type { NextRequest } from 'next/server';

import { commonErrors, errorResponse, successResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { draftApplicationService } from '@/server/draft/services/DraftApplicationService';
import { draftRealtimePublisher } from '@/server/draft/services/DraftRealtimePublisher';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function commandErrorResponse(error: unknown, draftId: string) {
  const message = error instanceof Error ? error.message : String(error);
  const [kind, detail] = message.includes(':') ? message.split(':', 2) : ['internal', message];

  if (kind === 'not_found') return commonErrors.notFound(detail);
  if (kind === 'bad_request') return commonErrors.badRequest(detail);
  if (kind === 'conflict') return errorResponse(detail || 'Draft state changed', 409);
  if (kind === 'forbidden') return commonErrors.forbidden(detail || 'Forbidden');

  logger.error('Failed to pause draft', {
    draftId,
    error: error instanceof Error ? error.message : String(error),
  });
  return errorResponse('Failed to pause draft', 500);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id: draftId } = await context.params;
  if (typeof draftId !== 'string' || draftId.trim().length === 0) {
    return errorResponse('Missing or invalid draftId', 400);
  }

  const actorUserId = await getAuthenticatedUserId(request);
  if (!actorUserId) {
    return commonErrors.unauthorized();
  }

  try {
    const result = await draftApplicationService.pauseDraft({ draftId, actorUserId });

    try {
      await draftRealtimePublisher.publishCommandResult(result);
    } catch (publishError) {
      logger.warn('Failed to publish draft pause side effects', { draftId, error: publishError });
    }

    return successResponse({
      message: 'Draft paused successfully',
      draft: {
        id: result.draftId,
        status: result.data.status,
        pausedAt: result.data.pausedAt,
      },
    });
  } catch (error) {
    return commandErrorResponse(error, draftId);
  }
}
