import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getLeagueMembership } from '@/lib/leagueMembership';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { loadMemberLineup, saveMemberLineup } from '@/server/leagues/lineupService';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; round: string }> }
) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, round } = await params;
  const membership = await getLeagueMembership(id, userId);
  if (!membership.isMember || !membership.memberDocId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const roundNumber = Number.parseInt(round, 10);
  if (!Number.isFinite(roundNumber) || roundNumber < 1) {
    return NextResponse.json({ error: 'Invalid round' }, { status: 400 });
  }

  const data = await loadMemberLineup({
    leagueId: id,
    memberId: membership.memberDocId,
    round: roundNumber,
  });
  return NextResponse.json(
    { success: true, data },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; round: string }> }
) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, round } = await params;
  const membership = await getLeagueMembership(id, userId);
  if (!membership.isMember || !membership.memberDocId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const roundNumber = Number.parseInt(round, 10);
  if (!Number.isFinite(roundNumber) || roundNumber < 1) {
    return NextResponse.json({ error: 'Invalid round' }, { status: 400 });
  }

  const body = (await request.json()) as { players?: unknown };
  const result = await saveMemberLineup({
    leagueId: id,
    memberId: membership.memberDocId,
    round: roundNumber,
    players: Array.isArray(body.players) ? body.players : [],
  });

  if (!result.ok) {
    return NextResponse.json({ error: 'Invalid lineup', details: result.errors }, { status: 400 });
  }

  return NextResponse.json({ success: true, data: result.data });
}
