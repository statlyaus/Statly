import type { NextRequest } from 'next/server';

import { z } from 'zod';

import { errorResponse, successResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { getDraftHistoryDetail } from '@/server/draft/readModels/draftHistoryReadModel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let userId: string | undefined;
  let draftId: string | undefined;

  try {
    const authenticatedUserId = await getAuthenticatedUserId(request);
    if (!authenticatedUserId) {
      return errorResponse('Unauthorized', 401);
    }
    userId = authenticatedUserId;

    const resolvedParams = await params;
    draftId = resolvedParams.id;

    if (!z.string().cuid().safeParse(draftId).success) {
      return errorResponse('Invalid draft id', 400);
    }

    const draftHistory = await getDraftHistoryDetail(prisma, userId, draftId);
    if (!draftHistory) {
      return errorResponse('Draft history not found', 404);
    }

    logger.info('Draft history detail retrieved', {
      userId,
      draftId,
      pickCount: draftHistory.picksMade,
    });

    return successResponse(draftHistory);
  } catch (error) {
    logger.error('Failed to get draft history detail', {
      userId,
      draftId,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse('Failed to get draft history detail', 500);
  }
}
