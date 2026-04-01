import { successResponse, errorResponse, commonErrors } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { draftApplicationService } from '@/server/draft/services/DraftApplicationService';
import { draftRealtimePublisher } from '@/server/draft/services/DraftRealtimePublisher';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request, context: any) {
  try {
    const draftId = ((await context?.params)?.id ??
      (Array.isArray((await context?.params)?.id) ? (await context.params).id[0] : undefined)) as
      | string
      | undefined;
    if (typeof draftId !== 'string' || draftId.trim().length === 0) {
      return errorResponse('Missing or invalid draftId', 400);
    }

    const result = await draftApplicationService.autoPick({ draftId });

    logger.info('Auto-pick made successfully', {
      draftId,
      pickNumber: result.currentPick - 1,
      playerId: result.data.pick.player.id,
      memberId: undefined,
      wasQueued: Boolean(result.data.wasQueued),
      isComplete: result.isComplete,
      idempotent: Boolean(result.data.idempotent),
    });

    try {
      await draftRealtimePublisher.publishCommandResult(result);
    } catch (publishError) {
      logger.warn('Failed to publish draft auto-pick side effects', {
        draftId,
        error: publishError,
      });
    }

    return successResponse({
      pick: result.data.pick,
      currentPick: result.currentPick,
      isComplete: result.isComplete,
      nextTurn: result.isComplete ? null : undefined,
      wasQueued: Boolean(result.data.wasQueued),
      idempotent: Boolean(result.data.idempotent),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const [kind, detail] = msg.includes(':') ? msg.split(':', 2) : ['internal', msg];

    if (kind === 'not_found') return commonErrors.notFound(detail);
    if (kind === 'bad_request') return commonErrors.badRequest(detail);
    if (kind === 'conflict') return errorResponse(detail || 'Draft state changed', 409);

    logger.error('Failed to auto-pick', {
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: msg,
        stack: error instanceof Error ? error.stack : undefined,
      },
    });

    return errorResponse('Failed to auto-pick', 500);
  }
}
