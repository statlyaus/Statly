import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { listMemberLeagueDrafts } from '@/server/draft/readModels/memberLeagueDraftsReadModel';

/**
 * Drafts of the leagues the viewer has an active team in, newest first.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return errorResponse('Unauthorized', 401);
    }

    const drafts = await listMemberLeagueDrafts(userId);

    logger.info('Listed drafts', { count: drafts.length });

    return successResponse({ count: drafts.length, drafts });
  } catch (error) {
    logger.error('Failed to list drafts', {
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse('Failed to list drafts', 500);
  }
}
