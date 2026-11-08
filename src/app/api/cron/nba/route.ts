import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { isCronRequestAuthorized } from '@/lib/cronAuth';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { isCronMonitorSlug, monitorCronRun } from '@/server/cron/cronMonitors';
import { createEspnNbaStatsProvider } from '@/server/basketball/ingest/espn/espnClient';
import {
  isNbaIngestJobName,
  type NbaIngestJobName,
  NBA_INGEST_JOBS,
  nbaSeasonForDate,
} from '@/server/basketball/ingest/nbaIngestJobs';
import { NbaIngestRejected } from '@/server/basketball/ingest/nbaStatsProvider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

// One bounded NBA ingest job per call: `?job=boxscores|schedule|players|injuries`, each called by its
// own netlify/functions/cron-nba-*.mts schedule. A rejected run (fetch_failed, parse_failed,
// out_of_bounds, unlicensed_provider) wrote only its NbaIngestRun row and answers 422; any other
// failure answers 500. Either way the scheduler logs it.
export async function GET(request: NextRequest) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401, headers: NO_STORE }
    );
  }

  const job = request.nextUrl.searchParams.get('job');
  if (!isNbaIngestJobName(job)) {
    return NextResponse.json(
      { ok: false, error: 'job must be one of boxscores, schedule, players, injuries' },
      { status: 400, headers: NO_STORE }
    );
  }

  // Only the box score job has a Sentry Crons monitor (docs/runbooks/monitoring-and-alerts.md).
  const monitorSlug = `cron-nba-${job}`;
  return isCronMonitorSlug(monitorSlug)
    ? monitorCronRun(monitorSlug, () => runNbaIngestJob(job))
    : runNbaIngestJob(job);
}

async function runNbaIngestJob(job: NbaIngestJobName): Promise<NextResponse> {
  const now = new Date();
  try {
    const { runId, summary } = await NBA_INGEST_JOBS[job]({
      prisma,
      provider: createEspnNbaStatsProvider(),
      season: nbaSeasonForDate(now),
      now,
    });
    logger.info('NBA ingest ran', { job, runId });
    return NextResponse.json({ ok: true, job, runId, summary }, { headers: NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof NbaIngestRejected) {
      logger.error('NBA ingest rejected', { job, reason: error.reason, error: message });
      return NextResponse.json(
        { ok: false, job, reason: error.reason, error: message },
        { status: 422, headers: NO_STORE }
      );
    }
    logger.error('NBA ingest failed', { job, error: message });
    return NextResponse.json(
      { ok: false, job, error: 'NBA ingest failed' },
      { status: 500, headers: NO_STORE }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
