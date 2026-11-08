import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { isCronRequestAuthorized } from '@/lib/cronAuth';
import { logger } from '@/lib/logger';
import { monitorCronRun } from '@/server/cron/cronMonitors';
import { processDueLeagueWaivers } from '@/server/waivers/waiverSchedule';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Called hourly by netlify/functions/cron-waivers.mts; processes waivers only at 6 am Melbourne time.
export async function GET(request: NextRequest) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return monitorCronRun('cron-waivers', runScheduledWaivers);
}

async function runScheduledWaivers(): Promise<NextResponse> {
  try {
    const run = await processDueLeagueWaivers();
    if (run.ran) {
      logger.info('Scheduled waiver processing ran', {
        leagues: run.leagues.length,
        processed: run.leagues.reduce((sum, league) => sum + league.processed, 0),
      });
    }
    // A failed league makes the run fail, so the scheduler records it instead of a silent success.
    if (run.failedLeagueIds.length > 0) {
      logger.error('Scheduled waiver processing failed for some leagues', {
        failedLeagueIds: run.failedLeagueIds,
      });
      return NextResponse.json(
        { ok: false, ...run, checkedAt: new Date().toISOString() },
        { status: 500, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return NextResponse.json(
      { ok: true, ...run, checkedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    logger.error('Failed to process scheduled waivers', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { ok: false, error: 'Failed to process scheduled waivers' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
