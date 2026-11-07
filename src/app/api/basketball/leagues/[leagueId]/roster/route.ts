import type { NextRequest } from 'next/server';

import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { addBasketballRosterSpots } from '@/server/basketball/leagues/basketballLeagueCommands';

import { basketballResponse, readJsonBody } from '../../../basketballRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ leagueId: string }> };

/** Adds or moves up to 250 confirmed players: `{ entries: [{ playerId, teamId, ... }] }`. */
export async function POST(request: NextRequest, { params }: Context) {
  return basketballResponse(request, getAuthenticatedUserId(request), async (userId) =>
    addBasketballRosterSpots(userId, (await params).leagueId, await readJsonBody(request))
  );
}
