import type { NextRequest } from 'next/server';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { refreshLiveStatsIfNeeded } from '@/lib/liveStatsRefresh';
import { authorizeCronRequest } from '@/lib/operationalAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authorization = authorizeCronRequest(request);
    if (!authorization.ok) return authorization.response;

    const result = await refreshLiveStatsIfNeeded({
      minIntervalMs: 30_000,
      trigger: 'cron',
    });

    return successResponse(result);
  } catch (error) {
    logger.error('Failed to refresh live AFL stats', {
      error: error instanceof Error ? error.message : String(error),
    });
    return commonErrors.internalServerError('Failed to refresh live AFL stats');
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
