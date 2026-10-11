import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { isCronRequestAuthorized } from '@/lib/cronAuth';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import {
  ingestFootywireInjuryList,
  InjuryListIngestionRejected,
} from '@/server/injuries/injuryListIngestion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Called every 6 hours by netlify/functions/cron-injuries.mts. A rejected or failed run writes
// nothing and answers 500, so the scheduler logs it and the last good snapshot ages out on its own.
export async function GET(request: NextRequest) {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const run = await ingestFootywireInjuryList({ prisma });
    logger.info('Injury list ingestion ran', {
      outcome: run.outcome,
      snapshotId: run.snapshotId,
      ...run.counts,
    });
    return NextResponse.json(
      { ok: true, ...run, checkedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const rejected = error instanceof InjuryListIngestionRejected;
    logger.error(rejected ? 'Injury list ingestion rejected' : 'Failed to ingest the injury list', {
      reason: rejected ? error.reason : undefined,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        ok: false,
        error: rejected
          ? `Injury list ingestion rejected: ${error.reason}`
          : 'Failed to ingest the injury list',
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
