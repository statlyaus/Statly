import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { isCronRequestAuthorized } from '@/lib/cronAuth';
import { logger } from '@/lib/logger';
import { sweepBloodsuckerWindows } from '@/server/leagues/bloodsuckerAutoFill';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

// Called every 5 minutes by netlify/functions/cron-bloodsucker.mts. For now it only closes exclusive
// windows that are due (#1280); the full sweep and its Sentry monitor are ticket 7 (#1284).
export async function GET(request: NextRequest) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401, headers: NO_STORE }
    );
  }

  try {
    const run = await sweepBloodsuckerWindows();
    // A failed league makes the run fail, so the scheduler records it instead of a silent success.
    const ok = run.failedLeagueIds.length === 0;
    return NextResponse.json(
      { ok, ...run, checkedAt: new Date().toISOString() },
      { status: ok ? 200 : 500, headers: NO_STORE }
    );
  } catch (error) {
    logger.error('Failed to sweep Bloodsucker windows', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { ok: false, error: 'Failed to sweep Bloodsucker windows' },
      { status: 500, headers: NO_STORE }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
