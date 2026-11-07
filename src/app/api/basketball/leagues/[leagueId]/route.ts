import type { NextRequest } from 'next/server';

import { getAuthenticatedUserId } from '@/lib/serverAuth';
import {
  deleteBasketballLeague,
  updateBasketballLeague,
} from '@/server/basketball/leagues/basketballLeagueCommands';
import { getBasketballLeagueDetail } from '@/server/basketball/leagues/basketballLeagueQueries';

import { basketballResponse, readJsonBody } from '../../basketballRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ leagueId: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  return basketballResponse(request, getAuthenticatedUserId(request), async (userId) =>
    getBasketballLeagueDetail(userId, (await params).leagueId)
  );
}

/** Partial settings update; the merged settings must pass every create rule. */
export async function PATCH(request: NextRequest, { params }: Context) {
  return basketballResponse(request, getAuthenticatedUserId(request), async (userId) =>
    updateBasketballLeague(userId, (await params).leagueId, await readJsonBody(request))
  );
}

export async function DELETE(request: NextRequest, { params }: Context) {
  return basketballResponse(request, getAuthenticatedUserId(request), async (userId) =>
    deleteBasketballLeague(userId, (await params).leagueId)
  );
}
