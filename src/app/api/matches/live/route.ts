export const runtime = 'nodejs';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { commonErrors, createSuccessResponse } from '@/lib/apiResponse';
import type { ETLMatch, ETLPlayerStats } from '@/lib/etlIntegration';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { getLiveMatchDataResult } from '@/server/etl/etlRoundData';

export interface LiveMatchData {
  matches: ETLMatch[];
  stats: ETLPlayerStats[];
  /** Newest `last_seen_at` among the stats, or null when no stat row is live. */
  lastUpdate: string | null;
}

/**
 * The AFL matches in progress and their player stats, read from the ETL's Firestore projection.
 * The Match Centre reads this instead of the browser Firestore SDK, which the rules do not allow
 * to read `player_match_stats`.
 */
export async function GET(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) return commonErrors.unauthorized();

  const result = await getLiveMatchDataResult();
  if (!result.ok) {
    logger.error('Failed to fetch live match data', result.error);
    return commonErrors.internalServerError('Internal server error');
  }

  const lastUpdate = result.stats.reduce<string | null>(
    (newest, row) =>
      row.last_seen_at && (newest === null || row.last_seen_at > newest)
        ? row.last_seen_at
        : newest,
    null
  );
  const body: LiveMatchData = { matches: result.matches, stats: result.stats, lastUpdate };
  return NextResponse.json(createSuccessResponse(body), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
