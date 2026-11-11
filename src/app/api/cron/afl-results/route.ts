import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { isCronRequestAuthorized } from '@/lib/cronAuth';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import {
  readFixtureGamesStartedBetween,
  readMissingAflResults,
} from '@/server/etl/missingAflResults';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Called hourly by netlify/functions/cron-afl-results.mts. Each AFL game whose result is missing 6
// hours after its scheduled end is logged as an error, which logger forwards to Sentry, and the run
// answers 500. See docs/runbooks/monitoring-and-alerts.md for re-running the results ingest.
export async function GET(request: NextRequest) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const { checked, missing } = await readMissingAflResults({
      now: new Date(),
      prisma,
      readFixture: readFixtureGamesStartedBetween,
    });
    for (const game of missing) {
      logger.error(
        `Missing AFL result: ${game.home_team} v ${game.away_team} (${game.match_uid}) has no result 6 hours after its scheduled end`,
        { matchUid: game.match_uid, startTimeUtc: game.start_time_utc }
      );
    }
    const ok = missing.length === 0;
    return NextResponse.json(
      { ok, checked, missing: missing.map((game) => game.match_uid) },
      { status: ok ? 200 : 500, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    logger.error('Failed to check for missing AFL results', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { ok: false, error: 'Failed to check for missing AFL results' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
