export const runtime = 'nodejs';

import type { NextRequest } from 'next/server';
import { logger } from '@/lib/logger';
import { commonErrors, successResponse } from '@/lib/apiResponse';
import { mapRoundFixture, parseFixtureRound, parseFixtureSeason } from '@/lib/matchMapper';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { getRoundMatchesResult } from '@/server/etl/etlRoundData';

/** A round's AFL fixture, as the ETL wrote it to Firestore `matches`. */
export async function GET(request: NextRequest) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) return commonErrors.unauthorized();

  const round = parseFixtureRound(request.nextUrl.searchParams.get('round'));
  if (round === null) return commonErrors.badRequest('Invalid round parameter');
  const season = parseFixtureSeason(request.nextUrl.searchParams.get('season'), new Date());
  if (season === null) return commonErrors.badRequest('Invalid season parameter');

  const result = await getRoundMatchesResult(season, round);
  if (!result.ok) {
    logger.error(`Failed to fetch matches for ${season} round ${round}`, result.error, {
      season,
      round,
    });
    return commonErrors.internalServerError('Internal server error');
  }
  return successResponse(mapRoundFixture(result.matches));
}
