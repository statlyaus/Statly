import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getLeagueMembership } from '@/lib/leagueMembership';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { parseCompetitionRulesJson } from '@/server/leagues/competitionRules';
import { parseLineupSlotsJson } from '@/server/leagues/lineupSettings';
import {
  createSetupLineupRoundContext,
  loadMemberLineup,
  loadMemberLineupRoundContext,
  loadRoundPlayerGameStarts,
  normalizeLegacyBenchAssignments,
  resolveRequestedLineupRound,
  resolveCurrentCompetitionRoundNumber,
  saveMemberLineup,
  synchronizeLineupPlayerLocks,
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

  const publishedCurrentRound =
    round === 'current' ? await resolveCurrentCompetitionRoundNumber(id) : null;
  const roundNumber = resolveRequestedLineupRound({
    requestedRound: round,
    publishedCurrentRound,
  });
  if (roundNumber === null) return NextResponse.json({ error: 'Invalid round' }, { status: 400 });

  const [lineup, league, rosterPlayers, context] = await Promise.all([
    loadMemberLineup({
      leagueId: id,
      memberId: membership.memberDocId,
      round: roundNumber,
    }),
    prisma.league.findUnique({
      where: { id },
      include: {
        settings: true,
        members: { where: { userId }, select: { isCoCommissioner: true }, take: 1 },
      },
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
  const setupRequired = league.settings.competitionStatus === 'SETUP';
  const effectiveContext =
    context ?? (setupRequired ? createSetupLineupRoundContext(roundNumber) : null);
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
  const selectedLineup = lineup ?? carriedLineup;
  const normalizedPlayers = normalizeLegacyBenchAssignments(selectedLineup?.players ?? []);
  const timingResult =
    rules.lockPolicy === 'INDIVIDUAL_GAME_START'
      ? await loadRoundPlayerGameStarts({
          aflRound: effectiveContext?.aflRound ?? null,
          players: normalizedPlayers.map((player) => ({
            playerId: player.playerId,
            club: player.player.club,
          })),
        })
      : {
          ok: true as const,
          gameStartsByPlayerId: new Map<string, Date>(),
          timingStatus: 'AVAILABLE' as const,
        };
  if (!timingResult.ok) {
    return NextResponse.json(
      { error: 'Lineup timing unavailable', details: [timingResult.error] },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  const effectiveLocksByPlayerId = lineup
    ? await synchronizeLineupPlayerLocks({
        players: normalizedPlayers,
        gameStartsByPlayerId: timingResult.gameStartsByPlayerId,
      })
    : new Map<string, Date>();
  const responsePlayers = normalizedPlayers.map((player) => ({
    ...player,
    lockedAt: lineup
      ? (effectiveLocksByPlayerId.get(player.playerId)?.toISOString() ?? null)
      : null,
  }));
  const responseLineup = selectedLineup
    ? {
        ...selectedLineup,
        lockedAt: lineup ? selectedLineup.lockedAt : null,
        players: responsePlayers,
      }
    : null;

  const data = {
    lineup: responseLineup,
    players: responsePlayers,
    savedRound: lineup?.round ?? null,
    carriedFromRound: carriedLineup?.round ?? null,
    timingStatus: timingResult.timingStatus,
    rosterPlayers: rosterPlayers.map((row) => ({
      playerId: row.playerId,
      name: row.player.name,
      position: row.player.position,
      club: row.player.club,
    })),
    lineupSlots: parseLineupSlotsJson(league.settings.lineupSlotsJson),
    interchangeSlots: rules.interchangeSlots,
    setupRequired,
    canManageCompetition: league.ownerId === userId || league.members[0]?.isCoCommissioner === true,
    context: effectiveContext
      ? {
          ...effectiveContext,
          startsAt: effectiveContext.startsAt?.toISOString() ?? null,
          fallbackLockAt: effectiveContext.fallbackLockAt?.toISOString() ?? null,
          lockAt: effectiveContext.lockAt?.toISOString() ?? null,
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

  const publishedCurrentRound =
    round === 'current' ? await resolveCurrentCompetitionRoundNumber(id) : null;
  const roundNumber = resolveRequestedLineupRound({
    requestedRound: round,
    publishedCurrentRound,
  });
  if (roundNumber === null) return NextResponse.json({ error: 'Invalid round' }, { status: 400 });

  const body = (await request.json()) as { players?: unknown };
  const result = await saveMemberLineup({
    leagueId: id,
    memberId: membership.memberDocId,
    round: roundNumber,
    players: Array.isArray(body.players) ? body.players : [],
  });

  if (!result.ok) {
    const status =
      result.code === 'TIMING_UNAVAILABLE' ? 503 : result.code === 'RETRY_REQUIRED' ? 409 : 400;
    return NextResponse.json(
      {
        error:
          result.code === 'TIMING_UNAVAILABLE' ? 'Lineup timing unavailable' : 'Invalid lineup',
        details: result.errors,
      },
      { status }
    );
  }

  return NextResponse.json({ success: true, data: result.data });
}
