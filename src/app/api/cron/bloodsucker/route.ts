import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { isCronRequestAuthorized } from '@/lib/cronAuth';
import { logger } from '@/lib/logger';
import { monitorCronRun } from '@/server/cron/cronMonitors';
import { sweepBloodsuckerWindows } from '@/server/leagues/bloodsuckerAutoFill';
import { sweepDueBloodsuckerBites } from '@/server/leagues/bloodsuckerAutoBite';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

// Called every 5 minutes by netlify/functions/cron-bloodsucker.mts (NFR-3, NFR-7): closes due
// exclusive windows (#1280), then auto-executes due bites and runs bites waiting on a lock (#1284).
export async function GET(request: NextRequest) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401, headers: NO_STORE }
    );
  }

  return await monitorCronRun('cron-bloodsucker', runSweep);
}

async function runSweep(): Promise<NextResponse> {
  try {
    const now = new Date();
    const windows = await sweepBloodsuckerWindows(now);
    const bites = await sweepDueBloodsuckerBites(now);
    const failedLeagueIds = [...new Set([...windows.failedLeagueIds, ...bites.failedLeagueIds])];
    if (bites.autoExecutedBiteIds.length > 0 || bites.waitingLockBiteIds.length > 0) {
      logger.info('Bloodsucker sweep moved bites', {
        autoExecuted: bites.autoExecutedBiteIds.length,
        waitingLock: bites.waitingLockBiteIds.length,
      });
    }
    // A failed league makes the run fail, so the scheduler and Sentry record it (NFR-6).
    const ok = failedLeagueIds.length === 0;
    if (!ok) logger.error('Bloodsucker sweep failed for some leagues', { failedLeagueIds });
    return NextResponse.json(
      {
        ok,
        checkedLeagueIds: windows.checkedLeagueIds,
        closedLeagueIds: windows.closedLeagueIds,
        autoExecutedBiteIds: bites.autoExecutedBiteIds,
        waitingLockBiteIds: bites.waitingLockBiteIds,
        failedLeagueIds,
        checkedAt: now.toISOString(),
      },
      { status: ok ? 200 : 500, headers: NO_STORE }
    );
  } catch (error) {
    logger.error('Failed to run the Bloodsucker sweep', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { ok: false, error: 'Failed to run the Bloodsucker sweep' },
      { status: 500, headers: NO_STORE }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
