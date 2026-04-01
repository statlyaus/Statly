/**
 * Draft Control API Routes
 * /api/drafts/[id]/pause - Pause a draft
 * /api/drafts/[id]/resume - Resume a draft
 */

import { cookies } from 'next/headers';

import { successResponse, errorResponse, commonErrors } from '@/lib/apiResponse';
import { getBypassUserId, isAuthBypassEnabled } from '@/lib/authBypass';
import { adminAuth } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { draftApplicationService } from '@/server/draft/services/DraftApplicationService';
import { draftRealtimePublisher } from '@/server/draft/services/DraftRealtimePublisher';


export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request, context: any) {
  const draftId = ((await context?.params)?.id ??
    (Array.isArray((await context?.params)?.id) ? (await context.params).id[0] : undefined)) as
    | string
    | undefined;
  if (typeof draftId !== 'string' || draftId.trim().length === 0) {
    return errorResponse('Missing or invalid draftId', 400);
  }

  try {
    // Verify user authentication
    let userId: string;
    if (isAuthBypassEnabled()) {
      userId = getBypassUserId();
    } else {
      const cookieStore = await cookies();
      const sessionCookie = cookieStore.get('statly_session')?.value;

      if (!sessionCookie) {
        return errorResponse('Unauthorized', 401);
      }

      try {
        const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
        userId = decoded.uid;
      } catch (_verifyErr) {
        return errorResponse('Unauthorized', 401);
      }
    }

    const result = await draftApplicationService.pauseDraft({
      draftId,
      actorUserId: userId,
    });

    try {
      await draftRealtimePublisher.publishCommandResult(result);
    } catch (publishError) {
      logger.warn('Failed to publish draft pause side effects', { draftId, error: publishError });
    }

    logger.info('Draft paused successfully', {
      draftId,
      userId,
      newStatus: result.data.status,
    });

    return successResponse({
      message: 'Draft paused successfully',
      draft: {
        id: result.draftId,
        status: result.data.status,
        pausedAt: result.data.pausedAt,
      },
    });
  } catch (error) {
    logger.error('Failed to pause draft', {
      draftId,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse('Failed to pause draft', 500);
  }
}
