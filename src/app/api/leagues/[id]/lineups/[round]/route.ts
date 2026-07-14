import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getLeagueMembership } from '@/lib/leagueMembership';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { parseCompetitionRulesJson } from '@/server/leagues/competitionRules';
import { parseLineupSlotsJson } from '@/server/leagues/lineupSettings';
import {
  loadMemberLineup,
  loadMemberLineupRoundContext,
  loadRoundPlayerGameStarts,
  resolveCurrentCompetitionRoundNumber,
  saveMemberLineup,
} from '@/server/leagues/lineupService';

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

  const requestedRound =
    round === 'current' ? await resolveCurrentCompetitionRoundNumber(id) : Number.parseInt(round, 10);
  if (requestedRound === null || !Number.isFinite(requestedRound) || requestedRound < 1) {
    return NextResponse.json({ error: 'No published playable round is available.' }, { status: 400 });
  }
  const roundNumber = requestedRound;

  const [lineup, league, rosterPlayers, context] = await Promise.all([
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
    loadMemberLineupRoundContext({
      leagueId: id,
      memberId: membership.memberDocId,
      round: roundNumber,
    }),
  ]);
  if (!league?.settings) return NextResponse.json({ error: 'League not found' }, { status: 404 });
  const carriedLineup = lineup
    ? null
    : await prisma.leagueLineup.findFirst({
      where: { leagueId: id, memberId: membership.memberDocId, round: { lt: roundNumber } },
      include: {
        players: {
          include: { player: true },
          orderBy: [{ slot: 'asc' }, { slotIndex: 'asc' }],
        },
      },
      orderBy: { round: 'desc' },
    });
  const rules = parseCompetitionRulesJson(league.settings.competitionRulesJson, 'goals');
  const gameStartsByPlayerId = await loadRoundPlayerGameStarts({
    aflRound: context?.aflRound ?? null,
    playerIds: (lineup?.players ?? carriedLineup?.players ?? []).map((player) => player.playerId),
  });

  const data = {
    lineup: lineup ?? carriedLineup,
    players: (lineup?.players ?? carriedLineup?.players ?? []).map((player) => ({
      ...player,
      lockedAt:
        player.lockedAt ??
        (gameStartsByPlayerId.get(player.playerId) &&
        gameStartsByPlayerId.get(player.playerId)! <= new Date()
          ? gameStartsByPlayerId.get(player.playerId)!.toISOString()
          : null),
    })),
    savedRound: lineup?.round ?? null,
    carriedFromRound: carriedLineup?.round ?? null,
    rosterPlayers: rosterPlayers.map((row) => ({
      playerId: row.playerId,
      name: row.player.name,
      position: row.player.position,
      club: row.player.club,
    })),
    lineupSlots: parseLineupSlotsJson(league.settings.lineupSlotsJson),
    interchangeSlots: rules.interchangeSlots,
    context: context
      ? {
          ...context,
          startsAt: context.startsAt?.toISOString() ?? null,
          fallbackLockAt: context.fallbackLockAt?.toISOString() ?? null,
          lockAt: context.lockAt?.toISOString() ?? null,
        }
      : null,
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

  const requestedRound =
    round === 'current' ? await resolveCurrentCompetitionRoundNumber(id) : Number.parseInt(round, 10);
  if (requestedRound === null || !Number.isFinite(requestedRound) || requestedRound < 1) {
    return NextResponse.json({ error: 'No published playable round is available.' }, { status: 400 });
  }
  const roundNumber = requestedRound;

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
