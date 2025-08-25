import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { ensureRosterTables } from '@/lib/ensureLobbyColumns';
import { getUserIdFromRequest } from '@/lib/serverAuth';
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

// Deterministic hash for stable pseudo-random numbers
function hashStringToInt(str: string): number {
  // FNV-1a hash for better distribution
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function deriveDeterministicStats(position: string | null | undefined, seedKey: string) {
  const seed = hashStringToInt(seedKey);
  const base = position === 'MID' ? 90 : position === 'FWD' ? 80 : position === 'DEF' ? 75 : position === 'RUC' ? 85 : 75;
  const variance = (seed % 21) - 10; // -10..+10
  const averageScore = Math.max(40, Math.round(base + variance));
  const lastGameScore = Math.max(20, Math.round(averageScore + (((seed >> 3) % 31) - 15))); // ±15
  const projectedScore = Math.max(30, Math.round(averageScore + (((seed >> 5) % 21) - 10))); // ±10

  const basePrice = position === 'MID' ? 650000 : position === 'FWD' ? 600000 : position === 'DEF' ? 550000 : position === 'RUC' ? 580000 : 500000;
  const priceVar = ((seed >> 7) % 200001) - 100000; // -100k..+100k
  const price = Math.max(100000, basePrice + priceVar);

  const form = [
    lastGameScore,
    Math.max(20, Math.round(averageScore + (((seed >> 9) % 21) - 10))),
    Math.max(20, Math.round(averageScore + (((seed >> 11) % 21) - 10))),
    Math.max(20, Math.round(averageScore + (((seed >> 13) % 21) - 10))),
    Math.max(20, Math.round(averageScore + (((seed >> 15) % 21) - 10))),
  ];

  return { price, averageScore, lastGameScore, projectedScore, form } as const;
}

const PutSchema = z.object({
  playerIds: z.array(z.string()).default([]),
  captainId: z.string().optional().nullable(),
  viceCaptainId: z.string().optional().nullable(),
  benchOrder: z.array(z.string()).optional().nullable(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; userId: string } }
) {
  try {
    const { id: leagueId, userId } = params;

    if (!leagueId || !userId) {
      return errorResponse('League ID and User ID are required', 400);
    }

    // Auth: require server-validated identity
    const reqUserId = await getUserIdFromRequest(request);
    if (!reqUserId) return errorResponse('Unauthorized', 401);
    if (reqUserId !== userId) return errorResponse('Forbidden', 403);

    await ensureRosterTablesOnce();

    // Fetch member and league in a single transaction
    const [member, league] = await prisma.$transaction([
      prisma.leagueMember.findFirst({ where: { leagueId, userId } }),
      prisma.league.findUnique({ where: { id: leagueId }, include: { settings: true } }),
    ]);

    if (!member) return errorResponse('User is not a member of this league', 404);
    if (!league) return errorResponse('League not found', 404);

    // Read existing roster (ORM)
    let roster = await prisma.leagueRoster.findUnique({
      where: { leagueId_memberId: { leagueId, memberId: member.id } },
    });

    // If missing, initialize from draft picks (first-time only)
    if (!roster) {
      const draft = await prisma.draft.findFirst({
        where: { leagueId },
        include: {
          picks: {
            where: { memberId: member.id },
            include: { player: true },
            orderBy: { overall: 'asc' },
          },
        },
      });

      if (draft && draft.picks.length > 0) {
        const playerIds = draft.picks.map((p) => p.playerId);
        // Upsert via ORM and return created/updated row
        roster = await prisma.leagueRoster.upsert({
          where: { leagueId_memberId: { leagueId, memberId: member.id } },
          create: {
            leagueId,
            memberId: member.id,
            playerIds: JSON.stringify(playerIds),
          },
          update: {
            playerIds: JSON.stringify(playerIds),
          },
        });
        logger.info('Created roster from draft picks', { leagueId, memberId: member.id, playerCount: playerIds.length });
      }
    }

    const playerIds = roster && roster.playerIds ? JSON.parse(String(roster.playerIds)) : [];
    const players = await prisma.player.findMany({ where: { id: { in: playerIds } } });

    // Deterministic (cacheable) stats instead of per-request randomness
    const playersWithStats = players.map((player) => {
      const stats = deriveDeterministicStats(player.position, `${player.id}:${leagueId}`);
      return {
        id: player.id,
        name: player.name,
        position: player.position,
        team: player.club,
        price: stats.price,
        averageScore: stats.averageScore,
        lastGameScore: stats.lastGameScore,
        projectedScore: stats.projectedScore,
        form: stats.form,
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
        players: playersWithStats,
        captainId: roster?.captainId ?? null,
        viceCaptainId: roster?.viceCaptainId ?? null,
        benchOrder: roster?.benchOrder ? JSON.parse(String(roster.benchOrder)) : [],
        totalValue: playersWithStats.reduce((sum, p) => sum + p.price, 0),
        averageScore: Math.round((playersWithStats.reduce((s, p) => s + p.averageScore, 0) / (playersWithStats.length || 1)) || 0),
        updatedAt: roster?.updatedAt || new Date(),
      },
      leagueSettings: {
        enableCaptainSystem: Boolean(league.settings?.enableCaptainSystem ?? true),
        captainMultiplier: Number(league.settings?.captainMultiplier ?? 2.0),
        viceCaptainMultiplier: Number(league.settings?.viceCaptainMultiplier ?? 1.5),
      },
    };

    return successResponse(response);
  } catch (error) {
    logger.error('Failed to get league roster', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse('Failed to retrieve roster', 500);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string; userId: string } }
) {
  try {
    const { id: leagueId, userId } = params;
    const raw = await request.json();
    const body = PutSchema.parse(raw);

    if (!leagueId || !userId) {
      return errorResponse('League ID and User ID are required', 400);
    }

    // Auth: require server-validated identity
    const reqUserId = await getUserIdFromRequest(request);
    if (!reqUserId) return errorResponse('Unauthorized', 401);
    if (reqUserId !== userId) return errorResponse('Forbidden', 403);

    await ensureRosterTablesOnce();

    const [member, league] = await prisma.$transaction([
      prisma.leagueMember.findFirst({ where: { leagueId, userId } }),
      prisma.league.findUnique({ where: { id: leagueId }, include: { settings: true } }),
    ]);

    if (!member) return errorResponse('User is not a member of this league', 404);
    if (!league) return errorResponse('League not found', 404);

    // Validate captain/vice vs playerIds
    if (body.captainId && !body.playerIds.includes(body.captainId)) {
      return errorResponse('Captain must be on the roster', 400);
    }
    if (body.viceCaptainId && !body.playerIds.includes(body.viceCaptainId)) {
      return errorResponse('Vice-captain must be on the roster', 400);
    }
    if (body.captainId && body.viceCaptainId && body.captainId === body.viceCaptainId) {
      return errorResponse('Captain and vice-captain cannot be the same player', 400);
    }

    const benchOrderJson = body.benchOrder ? JSON.stringify(body.benchOrder) : null;

    // Upsert roster atomically via ORM and return updated row
    const roster = await prisma.leagueRoster.upsert({
      where: { leagueId_memberId: { leagueId, memberId: member.id } },
      create: {
        leagueId,
        memberId: member.id,
        playerIds: JSON.stringify(body.playerIds),
        captainId: body.captainId || null,
        viceCaptainId: body.viceCaptainId || null,
        benchOrder: benchOrderJson,
      },
      update: {
        playerIds: JSON.stringify(body.playerIds),
        captainId: body.captainId || null,
        viceCaptainId: body.viceCaptainId || null,
        benchOrder: benchOrderJson,
      },
      select: { id: true, leagueId: true, memberId: true, captainId: true, viceCaptainId: true, benchOrder: true, updatedAt: true },
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
        updatedAt: roster.updatedAt ?? new Date(),
      },
    });
  } catch (error) {
    logger.error('Failed to update league roster', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse('Failed to update roster', 500);
  }
}
