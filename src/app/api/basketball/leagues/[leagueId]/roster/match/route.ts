import type { NextRequest } from 'next/server';

import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { matchPastedRoster } from '@/server/basketball/leagues/basketballLeagueQueries';

import { basketballResponse, readJsonBody } from '../../../../basketballRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ leagueId: string }> };

/** Proposes players for each line of `{ text }`. Saves nothing; the client confirms via `/roster`. */
export async function POST(request: NextRequest, { params }: Context) {
  return basketballResponse(request, getAuthenticatedUserId(request), async (userId) =>
    matchPastedRoster(userId, (await params).leagueId, await readJsonBody(request))
  );
}
