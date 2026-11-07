import type { NextRequest } from 'next/server';

import { getAuthenticatedUserId } from '@/lib/serverAuth';
import {
  removeBasketballRosterSpot,
  updateBasketballRosterSpot,
} from '@/server/basketball/leagues/basketballLeagueCommands';

import { basketballResponse, readJsonBody } from '../../../../basketballRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ leagueId: string; playerId: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  return basketballResponse(request, getAuthenticatedUserId(request), async (userId) => {
    const { leagueId, playerId } = await params;
    return updateBasketballRosterSpot(userId, leagueId, playerId, await readJsonBody(request));
  });
}

export async function DELETE(request: NextRequest, { params }: Context) {
  return basketballResponse(request, getAuthenticatedUserId(request), async (userId) => {
    const { leagueId, playerId } = await params;
    return removeBasketballRosterSpot(userId, leagueId, playerId);
  });
}
