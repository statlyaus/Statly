import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getLeagueMembership } from '@/lib/leagueMembership';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { loadLeagueStandingsHistory } from '@/server/leagues/standingsHistoryLoader';

/** League ladder with round-by-round results, rank history and form, for league members. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const membership = await getLeagueMembership(id, userId);
  if (!membership.isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const history = await loadLeagueStandingsHistory(id);
  if (!history) return NextResponse.json({ error: 'League not found' }, { status: 404 });

  return NextResponse.json(
    { success: true, data: { ...history, viewerMemberId: membership.memberDocId ?? null } },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
