import type { NextRequest } from 'next/server';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { refreshLiveStatsIfNeeded } from '@/lib/liveStatsRefresh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return commonErrors.unauthorized();
    }

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
