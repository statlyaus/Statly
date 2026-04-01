import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { verifyLeagueMembership } from '@/lib/leagueMembership';
import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { leagueApplicationService } from '@/server/league/services/LeagueApplicationService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/leagues/[id]/players?limit=100&cursor=<lastId>&team=XXX&position=YYY&owned=true|false
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: leagueId } = await params;

  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const membership = await verifyLeagueMembership(leagueId, userId);
  if (!membership.isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const url = new URL(req.url);
    const limitParam = parseInt(url.searchParams.get('limit') || '100', 10);
    const limit = Math.max(10, Math.min(200, Number.isNaN(limitParam) ? 100 : limitParam));
    const cursor = url.searchParams.get('cursor') || undefined;
    const team = url.searchParams.get('team') || undefined;
    const position = url.searchParams.get('position') || undefined;
    const ownedStr = url.searchParams.get('owned');
    const owned = ownedStr === 'true' ? true : ownedStr === 'false' ? false : undefined;

    const result = await leagueApplicationService.listLeaguePlayers({
      leagueId,
      team,
      position,
      cursor,
      limit,
      owned,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    logger.error('Players API error', error instanceof Error ? error : new Error(String(error)), {
      leagueId,
    });
    return NextResponse.json({ error: 'Failed to fetch players' }, { status: 500 });
  }
}
