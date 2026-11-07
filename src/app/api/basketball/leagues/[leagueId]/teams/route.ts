import type { NextRequest } from 'next/server';

import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { setBasketballLeagueTeams } from '@/server/basketball/leagues/basketballLeagueCommands';

import { basketballResponse, readJsonBody } from '../../../basketballRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ leagueId: string }> };

/** Replaces the team list: `{ teams: [{ id?, name }] }`, the caller's own team always kept. */
export async function PUT(request: NextRequest, { params }: Context) {
  return basketballResponse(request, getAuthenticatedUserId(request), async (userId) =>
    setBasketballLeagueTeams(userId, (await params).leagueId, await readJsonBody(request))
  );
}
