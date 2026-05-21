import type { NextRequest } from 'next/server';

import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { getDefaultAflSeason, getRecentAflSeasons } from '@/lib/aflSeason';
import { isAuthBypassEnabled } from '@/lib/authBypass';
import { ensureRosterTables } from '@/lib/ensureLobbyColumns';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { CANONICAL_STAT_KEYS, type CanonicalStatKey } from '@/lib/stats/statColumns';
import { leagueApplicationService } from '@/server/league/services/LeagueApplicationService';
import { getLeagueRosterSummaryMap } from '@/server/readModels/playerReadModels';

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

function buildEmptyStats(): Record<CanonicalStatKey, number> {
  const empty = {} as Record<CanonicalStatKey, number>;
  for (const key of CANONICAL_STAT_KEYS) {
    empty[key] = 0;
  }
  return empty;
}

const DEFAULT_STATS_SEASONS = getRecentAflSeasons();

function parseSeasonsFromRequest(request: NextRequest): number[] {
  const params = request.nextUrl?.searchParams;
  if (!params) return [...DEFAULT_STATS_SEASONS];
  const seasonsParam = params.get('seasons');
  const seasonParam = params.get('season');
  const candidates =
    seasonsParam?.trim().length && seasonsParam !== '0'
      ? seasonsParam.split(',').map((value) => Number(value.trim()))
      : seasonParam && seasonParam.trim().length
        ? [Number(seasonParam)]
        : DEFAULT_STATS_SEASONS;
  const unique = Array.from(
    new Set(
      candidates
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  );
  return unique.length > 0 ? unique : [...DEFAULT_STATS_SEASONS];
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
      return commonErrors.badRequest('League ID and User ID are required');
    }

    // Auth: require server-validated identity
    const reqUserId = await getAuthenticatedUserId(request);
    if (!reqUserId) return commonErrors.unauthorized();

    await ensureRosterTablesOnce();

    const [context, requester] = await Promise.all([
      leagueApplicationService.getLeagueRosterContext({ leagueId, userId }),
      prisma.leagueMember.findFirst({ where: { leagueId, userId: reqUserId } }),
    ]);

    if (!context) {
      return commonErrors.notFound('User is not a member of this league');
    }
    if (!requester && !isAuthBypassEnabled()) return commonErrors.forbidden();

    const { member, league } = context;

    const seasons = parseSeasonsFromRequest(request);

    let roster: Awaited<ReturnType<typeof prisma.leagueRoster.findUnique>> = context.roster;

    let playerIds: string[] = context.playerIds;
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
          create: { leagueId, memberId: member.id },
          update: {},
        });
        try {
          const now = new Date();
          const rows = playerIds.map(
            (pid, idx) =>
              Prisma.sql`(${`${leagueId}:${member.id}:${pid}`}, ${leagueId}, ${member.id}, ${pid}, ${idx}, ${now}, ${now})`
          );
          if (rows.length > 0) {
            await prisma.$executeRaw`
              INSERT INTO "LeagueRosterPlayer" ("id", "leagueId", "memberId", "playerId", "sortOrder", "createdAt", "updatedAt")
              VALUES ${Prisma.join(rows)}
              ON CONFLICT ("leagueId", "memberId", "playerId") DO UPDATE SET "sortOrder" = excluded."sortOrder", "updatedAt" = excluded."updatedAt"
            `;
          }
        } catch (_e) {
          // Ignore insert errors; draft-derived roster metadata is still available.
        }
        roster = await prisma.leagueRoster.findUnique({
          where: { leagueId_memberId: { leagueId, memberId: member.id } },
        });
        logger.info('Created normalized roster from draft picks', {
          leagueId,
          memberId: member.id,
          playerCount: playerIds.length,
        });
      }
    } else {
      await prisma.leagueRoster.upsert({
        where: { leagueId_memberId: { leagueId, memberId: member.id } },
        create: { leagueId, memberId: member.id },
        update: {},
      });
      roster = await prisma.leagueRoster.findUnique({
        where: { leagueId_memberId: { leagueId, memberId: member.id } },
      });
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

    const rosterSummaryByPlayerId = await getLeagueRosterSummaryMap({
      prismaClient: prisma,
      leagueId,
      memberId: member.id,
      seasons,
      hydrateStatsFromSeasonSummaryForPlayerIds: playerIds,
      rosterCaptainId: roster?.captainId ?? null,
      rosterViceCaptainId: roster?.viceCaptainId ?? null,
    });

    const missingSummaryIds = playerIds.filter(
      (playerId) => !rosterSummaryByPlayerId.has(playerId)
    );
    if (missingSummaryIds.length > 0) {
      logger.warn('Roster players missing projected summaries', {
        leagueId,
        memberId: member.id,
        season: seasons[0] ?? getDefaultAflSeason(),
        missingCount: missingSummaryIds.length,
      });
    }

    const playersWithStats = orderedPlayers.map((player) => {
      const summary = rosterSummaryByPlayerId.get(String(player.id));
      const fallbackStats = deriveDeterministicStats(player.position, `${player.id}:${leagueId}`);
      const fallbackPrice =
        summary?.price && summary.price > 0 ? summary.price : fallbackStats.price;
      const fallbackLastGameScore =
        summary?.lastGameScore && summary.lastGameScore > 0
          ? summary.lastGameScore
          : fallbackStats.lastGameScore;
      const fallbackProjectedScore =
        summary?.projectedScore && summary.projectedScore > 0
          ? summary.projectedScore
          : fallbackStats.projectedScore;
      const fallbackForm =
        summary?.form && summary.form.length > 0 ? summary.form : fallbackStats.form;
      return {
        id: player.id,
        name: summary?.playerName ?? player.name,
        position: summary?.position ?? player.position,
        team: summary?.club ?? player.club,
        ownership: summary?.ownership ?? 0,
        isCaptain: summary?.isCaptain ?? roster?.captainId === player.id,
        isViceCaptain: summary?.isViceCaptain ?? roster?.viceCaptainId === player.id,
        stats: summary?.stats ?? buildEmptyStats(),
        statsTotal: summary?.totals ?? buildEmptyStats(),
        gamesPlayed: summary?.gamesPlayed ?? 0,
        price: fallbackPrice,
        averageScore: summary?.averageScore ?? 0,
        lastGameScore: fallbackLastGameScore,
        projectedScore: fallbackProjectedScore,
        form: fallbackForm,
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
      stack: error instanceof Error ? error.stack : undefined,
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

    if (!leagueId || !userId) {
      return commonErrors.badRequest('League ID and User ID are required');
    }

    // Auth: require server-validated identity
    const reqUserId = await getAuthenticatedUserId(request);
    if (!reqUserId) return commonErrors.unauthorized();
    if (reqUserId !== userId) return commonErrors.forbidden();

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return commonErrors.badRequest('Invalid JSON request body');
    }
    const parsed = PutSchema.safeParse(raw);
    if (!parsed.success) {
      return commonErrors.badRequest('Invalid roster request body', {
        issues: parsed.error.flatten().fieldErrors,
      });
    }
    const body = parsed.data;

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

    // Atomic: sync LeagueRosterPlayer (source of truth) + upsert LeagueRoster metadata
    const roster = await prisma.$transaction(async (tx) => {
      await tx.leagueRosterPlayer.deleteMany({
        where: { leagueId, memberId: member.id },
      });
      if (body.playerIds.length > 0) {
        await tx.leagueRosterPlayer.createMany({
          data: body.playerIds.map((playerId, sortOrder) => ({
            id: `${leagueId}:${member.id}:${playerId}`,
            leagueId,
            memberId: member.id,
            playerId,
            sortOrder,
          })),
        });
      }
      return tx.leagueRoster.upsert({
        where: { leagueId_memberId: { leagueId, memberId: member.id } },
        create: {
          leagueId,
          memberId: member.id,
          captainId: body.captainId || null,
          viceCaptainId: body.viceCaptainId || null,
          benchOrder: benchOrderJson,
        },
        update: {
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
