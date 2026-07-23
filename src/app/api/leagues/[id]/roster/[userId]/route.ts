import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { getPlayers } from '@/lib/data';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { ensureRosterTables } from '@/lib/ensureLobbyColumns';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import {
  buildLeaguePlayerStatDatasetForTargets,
  type LeaguePlayerStatTarget,
} from '@/server/players/readModels/leaguePlayerStatReadModel';
import { parseCategoryDirectionsJson } from '@/server/leagues/categoryDirections';
import {
  RosterPreferenceError,
  RosterProjectionService,
} from '@/server/rosters/RosterProjectionService';
import {
  REAL_DATA_NINE_CATEGORY_PRESET,
  normalizeFantasyCategoryKeys,
  type FantasyCategoryKey,
} from '@/types/fantasyCategories';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Ensure roster tables only once per cold start
let rosterTablesReady: Promise<void> | null = null;
async function ensureRosterTablesOnce() {
  if (!rosterTablesReady) {
    rosterTablesReady = ensureRosterTables()
      .then(() => undefined)
      .catch((e) => {
        rosterTablesReady = null;
        throw e;
      });
  }
  await rosterTablesReady;
}

function getSelectedLeagueCategories(rawCategories: unknown): FantasyCategoryKey[] {
  let parsed = rawCategories;
  if (typeof rawCategories === 'string') {
    try {
      parsed = JSON.parse(rawCategories);
    } catch {
      parsed = rawCategories.split(',').map((category) => category.trim());
    }
  }
  return normalizeFantasyCategoryKeys(parsed, REAL_DATA_NINE_CATEGORY_PRESET);
}

const PutSchema = z.object({
  playerIds: z.array(z.string()).default([]),
  captainId: z.string().optional().nullable(),
  viceCaptainId: z.string().optional().nullable(),
  benchOrder: z.array(z.string()).optional().nullable(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { id: leagueId, userId } = await params;

    if (!leagueId || !userId) {
      return errorResponse('League ID and User ID are required', 400);
    }

    // Auth: require server-validated identity
    const reqUserId = await getAuthenticatedUserId(request);
    if (!reqUserId) return errorResponse('Unauthorized', 401);
    if (reqUserId !== userId) return errorResponse('Forbidden', 403);

    await ensureRosterTablesOnce();

    const [member, league] = await prisma.$transaction([
      prisma.leagueMember.findFirst({
        where: { leagueId, userId, isActive: true, status: 'ACTIVE' },
      }),
      prisma.league.findUnique({ where: { id: leagueId }, include: { settings: true } }),
    ]);

    if (!member) return errorResponse('User is not a member of this league', 404);
    if (!league) return errorResponse('League not found', 404);

    const selectedCategories = getSelectedLeagueCategories(league.categoriesJson);
    const categoryDirections = parseCategoryDirectionsJson(
      selectedCategories,
      league.settings?.categoryDirectionsJson
    );
    const [roster, ownership, sourcePlayers] = await Promise.all([
      prisma.leagueRoster.findUnique({
        where: { leagueId_memberId: { leagueId, memberId: member.id } },
      }),
      prisma.leagueRosterPlayer.findMany({
        where: { leagueId, memberId: member.id },
        select: {
          player: { select: { id: true, name: true, club: true, position: true } },
        },
        orderBy: [{ acquiredAt: 'asc' }, { createdAt: 'asc' }],
      }),
      getPlayers(),
    ]);
    const orderedPlayers = ownership.map(({ player }) => player);
    const statTargets: LeaguePlayerStatTarget[] = orderedPlayers.map((player) => ({
      id: player.id,
      name: player.name,
      club: player.club,
    }));
    const leaguePlayerStats = buildLeaguePlayerStatDatasetForTargets(sourcePlayers, statTargets, {
      categories: selectedCategories,
      categoryDirections,
    });
    const playersWithStats = orderedPlayers.map((player) => {
      const leagueStats = leaguePlayerStats.playersById[player.id];
      return {
        id: player.id,
        name: player.name,
        position: player.position,
        team: player.club,
        club: player.club,
        stats: leagueStats?.values ?? {},
        leagueStats,
        gamesPlayed: leagueStats?.gamesPlayed ?? 0,
        isCaptain: roster?.captainId === player.id,
        isViceCaptain: roster?.viceCaptainId === player.id,
      };
    });

    const response = {
      roster: {
        id: roster?.id || null,
        leagueId,
        memberId: member.id,
        teamName: member.teamName,
        playerIds: orderedPlayers.map((player) => player.id),
        players: playersWithStats,
        captainId: roster?.captainId ?? null,
        viceCaptainId: roster?.viceCaptainId ?? null,
        benchOrder: roster?.benchOrder ? JSON.parse(String(roster.benchOrder)) : [],
        updatedAt: roster?.updatedAt ?? null,
      },
      leaguePlayerStats,
      leagueSettings: {
        selectedCategories,
        categoryDirections,
        enableCaptainSystem: Boolean(league.settings?.enableCaptainSystem ?? true),
        captainMultiplier: Number(league.settings?.captainMultiplier ?? 2.0),
        viceCaptainMultiplier: Number(league.settings?.viceCaptainMultiplier ?? 1.5),
      },
    };

    return successResponse(response);
  } catch (error) {
    logger.error('Failed to get league roster', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to retrieve roster', 500);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { id: leagueId, userId } = await params;
    const raw = await request.json();
    const body = PutSchema.parse(raw);

    if (!leagueId || !userId) {
      return errorResponse('League ID and User ID are required', 400);
    }

    // Auth: require server-validated identity
    const reqUserId = await getAuthenticatedUserId(request);
    if (!reqUserId) return errorResponse('Unauthorized', 401);
    if (reqUserId !== userId) return errorResponse('Forbidden', 403);

    await ensureRosterTablesOnce();

    const [member, league] = await prisma.$transaction([
      prisma.leagueMember.findFirst({
        where: { leagueId, userId, isActive: true, status: 'ACTIVE' },
      }),
      prisma.league.findUnique({ where: { id: leagueId }, select: { id: true } }),
    ]);

    if (!member) return errorResponse('User is not a member of this league', 404);
    if (!league) return errorResponse('League not found', 404);

    const roster = await new RosterProjectionService().updateMemberPreferences({
      leagueId,
      memberId: member.id,
      submittedPlayerIds: body.playerIds,
      captainId: body.captainId,
      viceCaptainId: body.viceCaptainId,
      benchOrder: body.benchOrder,
    });

    logger.info('Updated league roster', { leagueId, memberId: member.id, rosterId: roster.id });

    return successResponse({
      roster: {
        id: roster.id,
        leagueId: roster.leagueId,
        memberId: roster.memberId,
        captainId: roster.captainId ?? null,
        viceCaptainId: roster.viceCaptainId ?? null,
        benchOrder: roster.benchOrder ? JSON.parse(String(roster.benchOrder)) : [],
        updatedAt: roster.updatedAt,
      },
    });
  } catch (error) {
    if (error instanceof RosterPreferenceError) {
      return errorResponse(error.message, error.status);
    }
    if (error instanceof z.ZodError) {
      return errorResponse('Invalid roster preferences', 400);
    }
    logger.error('Failed to update league roster', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to update roster', 500);
  }
}
