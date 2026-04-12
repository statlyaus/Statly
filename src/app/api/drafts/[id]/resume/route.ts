/**
 * Draft Resume API Routes
 * /api/drafts/[draftId]/resume - Resume a paused draft
 */

import type { NextRequest } from 'next/server';

import { successResponse, errorResponse, commonErrors } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { getUserIdFromRequest } from '@/lib/serverAuth';
import { draftApplicationService } from '@/server/draft/services/DraftApplicationService';
import { draftRealtimePublisher } from '@/server/draft/services/DraftRealtimePublisher';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: NextRequest, context: any) {
  const draftId = ((await context?.params)?.id ??
    (Array.isArray((await context?.params)?.id) ? (await context.params).id[0] : undefined)) as
    | string
    | undefined;
  if (typeof draftId !== 'string' || draftId.trim().length === 0) {
    return errorResponse('Missing or invalid draftId', 400);
  }

  try {
    // Verify user authentication using standardized helper
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return errorResponse('Unauthorized', 401);
    }

    const result = await draftApplicationService.resumeDraft({
      draftId,
      actorUserId: userId,
    });

    try {
      await draftRealtimePublisher.publishCommandResult(result);
    } catch (publishError) {
      logger.warn('Failed to publish draft resume side effects', { draftId, error: publishError });
    }

    logger.info('Draft resumed successfully', {
      draftId,
      userId,
      newStatus: result.data.status,
    });

    return successResponse({
      message: 'Draft resumed successfully',
      draft: {
        id: result.draftId,
        status: result.data.status,
        resumedAt: result.data.resumedAt,
        currentPick: result.currentPick,
      },
    });
  } catch (error) {
    logger.error('Failed to resume draft', {
      draftId,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse('Failed to resume draft', 500);
  }
}
