import type { NextRequest } from 'next/server';

import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { createBasketballLeague } from '@/server/basketball/leagues/basketballLeagueCommands';
import { listBasketballLeagues } from '@/server/basketball/leagues/basketballLeagueQueries';

import { basketballResponse, readJsonBody } from '../basketballRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The caller's basketball league profiles. */
export async function GET(request: NextRequest) {
  return basketballResponse(request, getAuthenticatedUserId(request), (userId) =>
    listBasketballLeagues(userId)
  );
}

/** Creates a profile owned by the caller; answers 201 with the new league's detail. */
export async function POST(request: NextRequest) {
  return basketballResponse(
    request,
    getAuthenticatedUserId(request),
    async (userId) => createBasketballLeague(userId, await readJsonBody(request)),
    201
  );
}
