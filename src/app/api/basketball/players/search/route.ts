import type { NextRequest } from 'next/server';

import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { searchNbaPlayers } from '@/server/basketball/leagues/basketballLeagueQueries';

import { basketballResponse } from '../../basketballRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Active NBA players by name, accent-insensitive: `?q=` (2+ characters) and optional `&limit=`. */
export async function GET(request: NextRequest) {
  return basketballResponse(request, getAuthenticatedUserId(request), async () => {
    const searchParams = request.nextUrl.searchParams;
    return searchNbaPlayers(searchParams.get('q'), {
      limit: searchParams.get('limit') ?? undefined,
    });
  });
}
