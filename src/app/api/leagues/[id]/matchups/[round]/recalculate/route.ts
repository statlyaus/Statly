import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getLeagueMembership, isLeagueManagerRole } from '@/lib/leagueMembership';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { recalculateLeagueRoundMatchups } from '@/server/leagues/matchupReadModel';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; round: string }> }
) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, round } = await params;
  const membership = await getLeagueMembership(id, userId);
  if (!membership.isMember || !isLeagueManagerRole(membership.data?.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const roundNumber = Number.parseInt(round, 10);
  if (!Number.isFinite(roundNumber) || roundNumber < 1) {
    return NextResponse.json({ error: 'Invalid round' }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { finalize?: boolean };
  const data = await recalculateLeagueRoundMatchups({
    leagueId: id,
    round: roundNumber,
    finalize: body.finalize === true,
  });
  if (!data) return NextResponse.json({ error: 'League not found' }, { status: 404 });

  return NextResponse.json({ success: true, data });
}
