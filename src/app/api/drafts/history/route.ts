import type { NextRequest } from 'next/server';

import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { LAST_LEAGUE_ID_COOKIE, parseLeaguePreference } from '@/lib/uiPreferences';
import {
  getDraftHistoryList,
  parseDraftHistoryLimit,
} from '@/server/draft/readModels/draftHistoryReadModel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  let userId: string | undefined;

  try {
    const authenticatedUserId = await getAuthenticatedUserId(request);
    if (!authenticatedUserId) {
      return errorResponse('Unauthorized', 401);
    }
    userId = authenticatedUserId;

    const url = new URL(request.url);
    const selectedLeagueId = parseLeaguePreference(
      url.searchParams.get('leagueId') ?? request.cookies.get(LAST_LEAGUE_ID_COOKIE)?.value
    );
    const draftHistory = await getDraftHistoryList(prisma, userId, {
      limit: parseDraftHistoryLimit(url.searchParams.get('limit')),
      leagueId: selectedLeagueId,
    });

    logger.info('Draft history retrieved', {
      userId,
      leagueId: selectedLeagueId,
      draftCount: draftHistory.drafts.length,
    });

    return successResponse(draftHistory);
  } catch (error) {
    logger.error('Failed to get draft history', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse('Failed to get draft history', 500);
  }
}
