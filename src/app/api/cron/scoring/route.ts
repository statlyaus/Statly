import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { isCronRequestAuthorized } from '@/lib/cronAuth';
import { logger } from '@/lib/logger';
import { monitorCronRun } from '@/server/cron/cronMonitors';
import { scoreStartedLeagueRounds } from '@/server/leagues/roundScoringSchedule';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Called hourly by netlify/functions/cron-scoring.mts. Any league that fails answers 500, so the
// scheduler logs the run as failed; the other leagues are still scored.
export async function GET(request: NextRequest) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  return monitorCronRun('cron-scoring', runScheduledScoring);
}

async function runScheduledScoring(): Promise<NextResponse> {
  try {
    const run = await scoreStartedLeagueRounds();
    const ok = run.failedLeagueIds.length === 0;
    if (ok) {
      logger.info('Scheduled round scoring ran', {
        leagues: run.leagues.length,
        rounds: run.leagues.reduce((sum, league) => sum + league.rounds.length, 0),
      });
    } else {
      logger.error('Scheduled round scoring failed', {
        leagues: run.leagues.length,
        failedLeagueIds: run.failedLeagueIds,
      });
    }
    return NextResponse.json(
      { ok, ...run, checkedAt: new Date().toISOString() },
      { status: ok ? 200 : 500, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    logger.error('Failed to run scheduled round scoring', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { ok: false, error: 'Failed to run scheduled round scoring' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
