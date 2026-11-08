import type { NextRequest } from 'next/server';

import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { clearBasketballTakenPlayers } from '@/server/basketball/leagues/basketballLeagueCommands';

import { basketballResponse } from '../../../../basketballRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ leagueId: string }> };

/** Removes every player marked as rostered elsewhere (taken); players on entered teams stay. */
export async function DELETE(request: NextRequest, { params }: Context) {
  return basketballResponse(request, getAuthenticatedUserId(request), async (userId) =>
    clearBasketballTakenPlayers(userId, (await params).leagueId)
  );
}
