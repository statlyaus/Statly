import type { NextRequest } from 'next/server';

import { getAuthenticatedUserId } from '@/lib/serverAuth';
import {
  clearBasketballMatchup,
  setBasketballMatchup,
} from '@/server/basketball/leagues/basketballLeagueCommands';

import { basketballResponse, readJsonBody } from '../../../../basketballRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ leagueId: string; week: string }> };

/** Sets the caller's opponent for the week: `{ opponentTeamId }`. */
export async function PUT(request: NextRequest, { params }: Context) {
  return basketballResponse(request, getAuthenticatedUserId(request), async (userId) => {
    const { leagueId, week } = await params;
    return setBasketballMatchup(userId, leagueId, week, await readJsonBody(request));
  });
}

export async function DELETE(request: NextRequest, { params }: Context) {
  return basketballResponse(request, getAuthenticatedUserId(request), async (userId) => {
    const { leagueId, week } = await params;
    return clearBasketballMatchup(userId, leagueId, week);
  });
}
