import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getPlayers } from '@/lib/data';
import { getLeagueMembership } from '@/lib/leagueMembership';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { parseCategoryDirectionsJson } from '@/server/leagues/categoryDirections';
import { parseCompetitionRulesJson } from '@/server/leagues/competitionRules';
import { buildDefaultLineup, type AutoFillSpot } from '@/lib/leagues/lineupAutoFill';
import {
  buildInjuryLookup,
  buildLineupSpots,
  ensureDefaultLineups,
  parseLeagueCategories,
  scoreRosterPlayers,
  toAutoFillPlayers,
} from '@/server/leagues/defaultLineups';
import { parseLineupSlotsJson } from '@/server/leagues/lineupSettings';
import { buildLeagueStandings } from '@/server/leagues/standingsReadModel';
import {
  createSetupLineupRoundContext,
  loadLineupRoundSummaries,
  loadMemberLineup,
  loadMemberLineupRoundContext,
  loadRoundPlayerFixtures,
  loadRoundPlayerGameStarts,
  normalizeLegacyBenchAssignments,
  resolveCurrentCompetitionRoundNumber,
  resolveNextEditableRoundNumber,
  resolveRequestedLineupRound,
  saveMemberLineup,
  synchronizeLineupPlayerLocks,
} from '@/server/leagues/lineupService';
import { buildLeaguePlayerStatDatasetForTargets } from '@/server/players/readModels/leaguePlayerStatReadModel';

async function resolveRoundNumber(leagueId: string, round: string): Promise<number | null> {
  const resolvedRound =
    round === 'next'
      ? await resolveNextEditableRoundNumber(leagueId)
      : round === 'current'
        ? await resolveCurrentCompetitionRoundNumber(leagueId)
        : null;
  return resolveRequestedLineupRound({
    requestedRound: round,
    publishedCurrentRound: resolvedRound,
  });
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

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
  const memberId = membership.memberDocId;

  const roundNumber = await resolveRoundNumber(id, round);
  if (roundNumber === null) return NextResponse.json({ error: 'Invalid round' }, { status: 400 });

  const now = new Date();
  const [initialLineup, league, rosterPlayers, context, roundSummaries] = await Promise.all([
    loadMemberLineup({ leagueId: id, memberId, round: roundNumber }),
    prisma.league.findUnique({
      where: { id },
      include: {
        settings: true,
        members: { where: { userId }, select: { isCoCommissioner: true }, take: 1 },
      },
    }),
    prisma.leagueRosterPlayer.findMany({
      where: { leagueId: id, memberId },
      include: { player: true },
      orderBy: { createdAt: 'asc' },
    }),
    loadMemberLineupRoundContext({ leagueId: id, memberId, round: roundNumber }),
    loadLineupRoundSummaries(id, now),
  ]);
  if (!league?.settings) return NextResponse.json({ error: 'League not found' }, { status: 404 });
  const setupRequired = league.settings.competitionStatus === 'SETUP';
  const effectiveContext =
    context ?? (setupRequired ? createSetupLineupRoundContext(roundNumber) : null);

  // Once a round has started, an unsaved lineup becomes the default team for real, so locks,
  // autosubs and scoring all see the same lineup the manager saw.
  let lineup = initialLineup;
  const roundHasStarted = Boolean(
    effectiveContext?.source === 'PUBLISHED' &&
    (effectiveContext.lockState === 'LOCKED' ||
      (effectiveContext.startsAt && effectiveContext.startsAt <= now))
  );
  if (!lineup && roundHasStarted) {
    const created = await ensureDefaultLineups({
      leagueId: id,
      round: roundNumber,
      memberIds: [memberId],
      now,
    });
    if (created > 0)
      lineup = await loadMemberLineup({ leagueId: id, memberId, round: roundNumber });
  }

  const carriedLineup = lineup
    ? null
    : await prisma.leagueLineup.findFirst({
        where: { leagueId: id, memberId, round: { lt: roundNumber } },
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

  // Game times for the whole squad, so every player row can show its fixture and lock time.
  const timingPlayers = new Map<string, { playerId: string; club: string }>();
  for (const row of rosterPlayers) {
    timingPlayers.set(row.playerId, { playerId: row.playerId, club: row.player.club });
  }
  for (const player of normalizedPlayers) {
    timingPlayers.set(player.playerId, { playerId: player.playerId, club: player.player.club });
  }
  const timingResult =
    rules.lockPolicy === 'INDIVIDUAL_GAME_START'
      ? await loadRoundPlayerGameStarts({
          aflRound: effectiveContext?.aflRound ?? null,
          players: [...timingPlayers.values()],
        })
      : {
          ok: true as const,
          gameStartsByPlayerId: new Map<string, Date>(),
          timingStatus: 'AVAILABLE' as const,
        };
  const timingUnavailable = !timingResult.ok;
  const gameStartsByPlayerId = timingResult.ok
    ? timingResult.gameStartsByPlayerId
    : new Map<string, Date>();

  // Without official game times we cannot tell which players have started, so an in-progress
  // round is shown read-only rather than presented as unlocked.
  const roundNotStarted = Boolean(effectiveContext?.startsAt && effectiveContext.startsAt > now);
  const lockState =
    timingUnavailable && effectiveContext?.lockState === 'OPEN' && !roundNotStarted
      ? 'TIMING_UNAVAILABLE'
      : (effectiveContext?.lockState ?? null);

  const effectiveLocksByPlayerId = !lineup
    ? new Map<string, Date>()
    : timingUnavailable
      ? new Map(
          normalizedPlayers
            .filter((player) => player.lockedAt)
            .map((player) => [player.playerId, player.lockedAt as Date])
        )
      : await synchronizeLineupPlayerLocks({
          players: normalizedPlayers,
          gameStartsByPlayerId,
        });
  const responsePlayers = normalizedPlayers.map((player) => ({
    ...player,
    lockedAt: lineup ? toIso(effectiveLocksByPlayerId.get(player.playerId)) : null,
  }));
  const responseLineup = selectedLineup
    ? {
        ...selectedLineup,
        lockedAt: lineup ? selectedLineup.lockedAt : null,
        players: responsePlayers,
      }
    : null;

  // Fixture context for every squad row: AFL opponent, home or away, start time and byes.
  const fixtureResult = await loadRoundPlayerFixtures({
    aflRound: effectiveContext?.aflRound ?? null,
    players: [...timingPlayers.values()],
  }).catch(() => ({ ok: false as const }));
  const fixturesByPlayerId = fixtureResult.ok ? fixtureResult.fixturesByPlayerId : new Map();

  // Record and ladder position for this team and this round's opponent.
  const [standingRows, activeMembers] = await Promise.all([
    prisma.leagueStanding.findMany({ where: { leagueId: id } }),
    prisma.leagueMember.findMany({
      where: { leagueId: id, isActive: true },
      select: { id: true, teamName: true, teamLogoUrl: true, draftSlot: true },
    }),
  ]);
  const ladder =
    standingRows.length > 0
      ? buildLeagueStandings({ members: activeMembers, standings: standingRows })
      : [];
  const describeTeam = (teamMemberId: string | null | undefined) => {
    if (!teamMemberId) return null;
    const member = activeMembers.find((entry) => entry.id === teamMemberId);
    if (!member) return null;
    const index = ladder.findIndex((row) => row.memberId === teamMemberId);
    const row = index >= 0 ? ladder[index] : null;
    return {
      memberId: member.id,
      teamName: member.teamName,
      logoUrl: member.teamLogoUrl,
      record: row ? { wins: row.wins, losses: row.losses, draws: row.draws } : null,
      rank: row ? index + 1 : null,
      teams: ladder.length || null,
    };
  };

  const categories = parseLeagueCategories(league.categoriesJson);
  let playerStats: ReturnType<typeof buildLeaguePlayerStatDatasetForTargets> | null = null;
  let injuryFor: ReturnType<typeof buildInjuryLookup> = () => null;
  let scores = new Map<string, number>();
  try {
    const sourcePlayers = await getPlayers();
    injuryFor = buildInjuryLookup(sourcePlayers);
    scores = scoreRosterPlayers({
      sourcePlayers,
      roster: rosterPlayers.map((row) => ({
        playerId: row.playerId,
        name: row.player.name,
        club: row.player.club,
      })),
      categoriesJson: league.categoriesJson,
      categoryDirectionsJson: league.settings.categoryDirectionsJson,
    });
    playerStats = buildLeaguePlayerStatDatasetForTargets(
      sourcePlayers,
      rosterPlayers.map((row) => ({
        id: row.playerId,
        name: row.player.name,
        club: row.player.club,
      })),
      {
        categories,
        categoryDirections: parseCategoryDirectionsJson(
          categories,
          league.settings.categoryDirectionsJson
        ),
      }
    );
  } catch (error) {
    logger.warn('Lineup player stats unavailable', { leagueId: id, error });
  }

  // No saved lineup: offer the default the team will get if the manager changes nothing, so
  // they only need to confirm changes. It is saved for real when the round starts.
  const lineupSlots = parseLineupSlotsJson(league.settings.lineupSlotsJson);
  const defaultLineup = lineup
    ? null
    : buildDefaultLineup({
        spots: buildLineupSpots(lineupSlots, rules.interchangeSlots),
        players: toAutoFillPlayers({
          roster: rosterPlayers.map((row) => ({
            playerId: row.playerId,
            name: row.player.name,
            position: row.player.position,
          })),
          fixturesByPlayerId,
          injuryFor,
          scores,
          now,
        }),
        previous: normalizedPlayers.map((player) => ({
          playerId: player.playerId,
          slot: player.slot as AutoFillSpot['slot'],
          slotIndex: player.slotIndex,
        })),
      });
  const lineupPlayers = defaultLineup
    ? defaultLineup.assignments.map((assignment) => ({ ...assignment, lockedAt: null }))
    : responsePlayers;

  const data = {
    lineup: responseLineup,
    players: lineupPlayers,
    defaultSource: defaultLineup?.source ?? null,
    requestedRound: roundNumber,
    savedRound: lineup?.round ?? null,
    carriedFromRound: carriedLineup?.round ?? null,
    timingStatus: timingUnavailable ? ('UNAVAILABLE' as const) : timingResult.timingStatus,
    rosterPlayers: rosterPlayers.map((row) => ({
      playerId: row.playerId,
      name: row.player.name,
      position: row.player.position,
      club: row.player.club,
      gameStartsAt: toIso(
        gameStartsByPlayerId.get(row.playerId) ?? fixturesByPlayerId.get(row.playerId)?.startsAt
      ),
      opponent: fixturesByPlayerId.get(row.playerId)?.opponent ?? null,
      isHome: fixturesByPlayerId.get(row.playerId)?.isHome ?? null,
      bye: fixturesByPlayerId.get(row.playerId)?.bye ?? false,
      injury: injuryFor({ playerId: row.playerId, name: row.player.name }),
    })),
    team: describeTeam(memberId),
    opponentTeam: describeTeam(effectiveContext?.opponent?.id),
    rounds: roundSummaries.map((summary) => ({
      ...summary,
      startsAt: toIso(summary.startsAt),
      endsAt: toIso(summary.endsAt),
      lockAt: toIso(summary.lockAt),
    })),
    categories,
    playerStats,
    lineupSlots,
    interchangeSlots: rules.interchangeSlots,
    lockPolicy: rules.lockPolicy,
    setupRequired,
    canManageCompetition: league.ownerId === userId || league.members[0]?.isCoCommissioner === true,
    context: effectiveContext
      ? {
          ...effectiveContext,
          lockState,
          startsAt: toIso(effectiveContext.startsAt),
          fallbackLockAt: toIso(effectiveContext.fallbackLockAt),
          lockAt: toIso(effectiveContext.lockAt),
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

  const roundNumber = await resolveRoundNumber(id, round);
  if (roundNumber === null) return NextResponse.json({ error: 'Invalid round' }, { status: 400 });

  const body = (await request.json().catch(() => null)) as { players?: unknown } | null;
  if (!body || !Array.isArray(body.players)) {
    // An omitted list must never be read as "clear my lineup".
    return NextResponse.json(
      { error: 'Invalid lineup', details: ['Lineup payload must include a players list.'] },
      { status: 400 }
    );
  }
  const result = await saveMemberLineup({
    leagueId: id,
    memberId: membership.memberDocId,
    round: roundNumber,
    players: body.players,
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
