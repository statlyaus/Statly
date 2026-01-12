import type { NextRequest } from 'next/server';

import { z } from 'zod';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { getPlayers } from '@/lib/data';
import { ensureRosterTables } from '@/lib/ensureLobbyColumns';
import { getLeagueOwnershipMap } from '@/lib/leagueOwnership';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';

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
  const base =
    position === 'MID'
      ? 90
      : position === 'FWD'
        ? 80
        : position === 'DEF'
          ? 75
          : position === 'RUC'
            ? 85
            : 75;
  const variance = (seed % 21) - 10; // -10..+10
  const averageScore = Math.max(40, Math.round(base + variance));
  const lastGameScore = Math.max(20, Math.round(averageScore + (((seed >> 3) % 31) - 15))); // ±15
  const projectedScore = Math.max(30, Math.round(averageScore + (((seed >> 5) % 21) - 10))); // ±10

  const basePrice =
    position === 'MID'
      ? 650000
      : position === 'FWD'
        ? 600000
        : position === 'DEF'
          ? 550000
          : position === 'RUC'
            ? 580000
            : 500000;
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

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getStatNumber(stats: Record<string, unknown> | undefined, key: string): number | null {
  if (!stats) return null;
  return toNumber(stats[key]);
}

const PutSchema = z.object({
  playerIds: z.array(z.string()).default([]),
  captainId: z.string().optional().nullable(),
  viceCaptainId: z.string().optional().nullable(),
  benchOrder: z.array(z.string()).optional().nullable(),
});

import { Prisma } from '@prisma/client';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { id: leagueId, userId } = await params;

    if (!leagueId || !userId) {
      return commonErrors.badRequest('League ID and User ID are required');
    }

    // Auth: require server-validated identity
    const reqUserId = await getAuthenticatedUserId(request);
    if (!reqUserId) return commonErrors.unauthorized();

    await ensureRosterTablesOnce();

    // Fetch member and league in a single transaction
    const [member, league, requester] = await prisma.$transaction([
      prisma.leagueMember.findFirst({ where: { leagueId, userId } }),
      prisma.league.findUnique({ where: { id: leagueId }, include: { settings: true } }),
      prisma.leagueMember.findFirst({ where: { leagueId, userId: reqUserId } }),
    ]);

    if (!member) return commonErrors.notFound('User is not a member of this league');
    if (!league) return commonErrors.notFound('League not found');
    if (!requester) return commonErrors.forbidden();

    // Read normalized roster rows first; fallback to JSON list
    // Use raw SQL to avoid depending on Prisma schema migrations
    const rows =
      (await prisma.$queryRaw`SELECT "playerId" FROM "LeagueRosterPlayer" WHERE "leagueId" = ${leagueId} AND "memberId" = ${member.id} ORDER BY "createdAt" ASC`) as Array<{
        playerId: string;
      }>;

    // Read existing roster row (JSON payload) for compatibility
    let roster = await prisma.leagueRoster.findUnique({
      where: { leagueId_memberId: { leagueId, memberId: member.id } },
    });

    let playerIds: string[] = [];
    if (Array.isArray(rows) && rows.length > 0) {
      playerIds = rows.map((r) => String(r.playerId));
      // Keep JSON roster in sync for compatibility
      await prisma.leagueRoster.upsert({
        where: { leagueId_memberId: { leagueId, memberId: member.id } },
        create: { leagueId, memberId: member.id, playerIds: JSON.stringify(playerIds) },
        update: { playerIds: JSON.stringify(playerIds) },
      });
      // Refresh roster row
      roster = await prisma.leagueRoster.findUnique({
        where: { leagueId_memberId: { leagueId, memberId: member.id } },
      });
    } else {
      // Fallback to JSON roster storage if join table is empty
      const fromJson = roster && roster.playerIds ? JSON.parse(String(roster.playerIds)) : [];
      playerIds = Array.isArray(fromJson) ? fromJson.map(String) : [];
      // If both are empty, initialize from draft picks
      if (playerIds.length === 0) {
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
          playerIds = draft.picks.map((p) => String(p.playerId));
          await prisma.leagueRoster.upsert({
            where: { leagueId_memberId: { leagueId, memberId: member.id } },
            create: { leagueId, memberId: member.id, playerIds: JSON.stringify(playerIds) },
            update: { playerIds: JSON.stringify(playerIds) },
          });
          // Insert into normalized table for future reads (batched)
          try {
            const rows = playerIds.map(
              (pid) =>
                Prisma.sql`(${`${leagueId}:${member.id}:${pid}`}, ${leagueId}, ${member.id}, ${pid})`
            );
            if (rows.length > 0) {
              await prisma.$executeRaw`
                INSERT INTO "LeagueRosterPlayer" ("id", "leagueId", "memberId", "playerId")
                VALUES ${Prisma.join(rows)}
                ON CONFLICT ("leagueId", "memberId", "playerId") DO NOTHING
              `;
            }
          } catch (_e) {
            // Ignore table/insert errors; JSON still accurate
          }
          // Refresh roster row
          roster = await prisma.leagueRoster.findUnique({
            where: { leagueId_memberId: { leagueId, memberId: member.id } },
          });
          logger.info('Created roster from draft picks', {
            leagueId,
            memberId: member.id,
            playerCount: playerIds.length,
          });
        }
      }
    }
    const players =
      playerIds.length > 0
        ? await prisma.player.findMany({ where: { id: { in: playerIds } } })
        : [];

    // Preserve original input order
    const byId = new Map(players.map((p) => [String(p.id), p] as const));
    const orderedPlayers = playerIds
      .map((pid) => byId.get(String(pid)))
      .filter(Boolean) as typeof players;

    const dataSet = new Set(playerIds.map(String));
    const allPlayers = await getPlayers();
    const playerDataMap = new Map(allPlayers.filter((p) => dataSet.has(p.id)).map((p) => [p.id, p]));

    let ownershipCounts = new Map<string, number>();
    let totalTeams = 0;
    try {
      const ownership = await getLeagueOwnershipMap(leagueId, playerIds);
      ownershipCounts = ownership.counts;
      totalTeams = ownership.totalTeams;
    } catch (_err) {
      // Ownership is optional; fall back to 0% if it can't be computed.
    }

    // Prefer real stats from /players data when available; fall back to deterministic stats
    const playersWithStats = orderedPlayers.map((player) => {
      const playerData = playerDataMap.get(String(player.id));
      const stats = playerData?.stats as Record<string, unknown> | undefined;
      const afl =
        getStatNumber(stats, 'aflFantasy') ??
        getStatNumber(stats, 'AF') ??
        toNumber((playerData as Record<string, unknown> | undefined)?.aflFantasy) ??
        toNumber((playerData as Record<string, unknown> | undefined)?.AF);
      const fallbackStats = deriveDeterministicStats(player.position, `${player.id}:${leagueId}`);
      const averageScore = afl ?? fallbackStats.averageScore;
      const lastGameScore = afl ?? fallbackStats.lastGameScore;
      const projectedScore = afl ?? fallbackStats.projectedScore;
      const form =
        typeof afl === 'number'
          ? [afl, afl, afl, afl, afl]
          : fallbackStats.form;
      const ownedCount = ownershipCounts.get(String(player.id)) ?? 0;
      const ownership =
        totalTeams > 0 ? Math.max(0, Math.min(100, Math.round((ownedCount / totalTeams) * 100))) : 0;
      return {
        id: player.id,
        name: playerData?.name ?? player.name,
        position: playerData?.position ?? player.position,
        team: playerData?.team ?? player.club,
        injury: playerData?.injury,
        stats: playerData?.stats,
        price: fallbackStats.price,
        averageScore,
        lastGameScore,
        projectedScore,
        form,
        ...(playerData ?? {}),
        ownership,
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
        averageScore: Math.round(
          playersWithStats.reduce((s, p) => s + p.averageScore, 0) /
            (playersWithStats.length || 1) || 0
        ),
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
    logger.error('Failed to get league roster', {
      error: error instanceof Error ? error.message : String(error),
    });
      return commonErrors.internalServerError('Failed to retrieve roster');
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
      return commonErrors.badRequest('League ID and User ID are required');
    }

    // Auth: require server-validated identity
    const reqUserId = await getAuthenticatedUserId(request);
    if (!reqUserId) return commonErrors.unauthorized();
    if (reqUserId !== userId) return commonErrors.forbidden();

    await ensureRosterTablesOnce();

    const [member, league] = await prisma.$transaction([
      prisma.leagueMember.findFirst({ where: { leagueId, userId } }),
      prisma.league.findUnique({ where: { id: leagueId }, include: { settings: true } }),
    ]);

    if (!member) return commonErrors.notFound('User is not a member of this league');
    if (!league) return commonErrors.notFound('League not found');

    // Validate captain/vice vs playerIds
    if (body.captainId && !body.playerIds.includes(body.captainId)) {
      return commonErrors.badRequest('Captain must be on the roster');
    }
    if (body.viceCaptainId && !body.playerIds.includes(body.viceCaptainId)) {
      return commonErrors.badRequest('Vice-captain must be on the roster');
    }
    if (body.captainId && body.viceCaptainId && body.captainId === body.viceCaptainId) {
      return commonErrors.badRequest('Captain and vice-captain cannot be the same player');
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
      select: {
        id: true,
        leagueId: true,
        memberId: true,
        captainId: true,
        viceCaptainId: true,
        benchOrder: true,
        updatedAt: true,
      },
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
    logger.error('Failed to update league roster', {
      error: error instanceof Error ? error.message : String(error),
    });
    return commonErrors.internalServerError('Failed to update roster');
  }
}
