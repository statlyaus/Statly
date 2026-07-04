import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getLeagueMembership } from '@/lib/leagueMembership';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { parseLineupSlotsJson } from '@/server/leagues/lineupSettings';
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

  const [lineup, league, rosterPlayers] = await Promise.all([
    loadMemberLineup({
      leagueId: id,
      memberId: membership.memberDocId,
      round: roundNumber,
    }),
    prisma.league.findUnique({
      where: { id },
      include: { settings: true },
    }),
    prisma.leagueRosterPlayer.findMany({
      where: { leagueId: id, memberId: membership.memberDocId },
      include: { player: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  if (!league?.settings) return NextResponse.json({ error: 'League not found' }, { status: 404 });

  const data = {
    lineup,
    players: lineup?.players ?? [],
    rosterPlayers: rosterPlayers.map((row) => ({
      playerId: row.playerId,
      name: row.player.name,
      position: row.player.position,
      club: row.player.club,
    })),
    lineupSlots: parseLineupSlotsJson(league.settings.lineupSlotsJson),
  };
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
