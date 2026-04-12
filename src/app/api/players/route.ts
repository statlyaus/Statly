export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

import { z } from 'zod';

import { middlewareConfigs } from '@/lib/apiMiddleware';
import { getDefaultAflSeason } from '@/lib/aflSeason';
import { verifyLeagueMembership } from '@/lib/leagueMembership';
import { getLeagueOwnershipDetails } from '@/lib/leagueOwnership';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { CANONICAL_STAT_KEYS, type CanonicalStatKey } from '@/lib/stats/statColumns';
import {
  getPlayerSeasonSummaryMap,
  resolveLatestProjectedSeason,
} from '@/server/readModels/playerReadModels';

function buildEmptyStats(): Record<CanonicalStatKey, number> {
  const empty = {} as Record<CanonicalStatKey, number>;
  for (const key of CANONICAL_STAT_KEYS) {
    empty[key] = 0;
  }
  return empty;
}

const querySchema = z.object({
  search: z.string().optional(),
  team: z.string().optional(),
  position: z.string().optional(),
  season: z
    .string()
    .optional()
    .transform((val, ctx) => {
      if (!val || val.trim() === '') {
        return undefined;
      }
      const num = Number(val);
      if (!Number.isFinite(num) || !Number.isInteger(num) || num < 2020 || num > 2030) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Season must be a year between 2020 and 2030',
        });
        return z.NEVER;
      }
      return num;
    }),
  page: z
    .string()
    .optional()
    .transform((val, ctx) => {
      if (!val || val.trim() === '') return 1; // default
      const num = Number(val);
      if (!Number.isFinite(num) || !Number.isInteger(num) || num < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Page must be a positive integer',
        });
        return z.NEVER;
      }
      return num;
    })
    .default(1),
  limit: z
    .string()
    .optional()
    .transform((val, ctx) => {
      if (!val || val.trim() === '') return 20; // default
      const num = Number(val);
      if (!Number.isFinite(num) || !Number.isInteger(num) || num < 1 || num > 1000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Limit must be an integer between 1 and 1000',
        });
        return z.NEVER;
      }
      return num;
    })
    .default(20),
});

export const GET = middlewareConfigs.public(async ({ req }) => {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = querySchema.safeParse(params);

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors;
    return NextResponse.json({ errors }, { status: 400 });
  }

  const { search, team, position, season: requestedSeason, page, limit } = parsed.data;
  const leagueId = req.nextUrl.searchParams.get('leagueId') || undefined;
  const start = (page - 1) * limit;
  const season =
    requestedSeason ?? (await resolveLatestProjectedSeason(prisma, getDefaultAflSeason()));

  const where: {
    club?: string;
    position?: string;
    OR?: Array<{
      name?: { contains: string; mode: 'insensitive' };
      club?: { contains: string; mode: 'insensitive' };
      position?: { contains: string; mode: 'insensitive' };
    }>;
  } = {};
  if (team) where.club = team;
  if (position) where.position = position;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { club: { contains: search, mode: 'insensitive' } },
      { position: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (leagueId) {
    const uid = await getAuthenticatedUserId(req);
    if (!uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const membership = await verifyLeagueMembership(leagueId, uid);
    if (!membership.isMember) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const [total, dbPlayers] = await Promise.all([
    prisma.player.count({ where }),
    prisma.player.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: start,
      take: limit,
    }),
  ]);

  const statsById = await getPlayerSeasonSummaryMap(
    prisma,
    season,
    dbPlayers.map((player) => player.id)
  );

  const pagedPlayers = dbPlayers.map((player) => {
    const summary = statsById.get(player.id);
    const stats = summary?.stats ?? buildEmptyStats();
    return {
      id: player.id,
      name: summary?.playerName ?? player.name,
      team: summary?.club ?? player.club,
      position: summary?.position ?? player.position,
      ...stats,
      stats,
      statsTotal: summary?.totals,
      gamesPlayed: summary?.gamesPlayed ?? 0,
      averageScore: summary?.averageScore ?? 0,
      totalValue: summary?.totalValue ?? 0,
    };
  });

  let enrichedPlayers = pagedPlayers;
  if (leagueId) {
    const ids = pagedPlayers.map((p) => p.id);
    const { totalTeams, counts, owners } = await getLeagueOwnershipDetails(leagueId, ids);
    const pendingWaiverClaims = await prisma.waiverClaim.findMany({
      where: {
        leagueId,
        status: 'PENDING',
      },
      select: {
        playerId: true,
      },
    });
    const waiverSet = new Set(pendingWaiverClaims.map((claim) => String(claim.playerId)));

    enrichedPlayers = pagedPlayers.map((p) => {
      const count = counts.get(p.id) ?? 0;
      const ownership = totalTeams > 0 ? Math.round((count / totalTeams) * 100) : 0;
      const ownerTeams = owners.get(p.id) ?? [];
      const ownerTeam = ownerTeams.length ? ownerTeams.join(', ') : undefined;
      const ownershipStatus = waiverSet.has(String(p.id))
        ? 'Waiver'
        : count > 0
          ? 'Owned'
          : 'Available';
      return { ...p, ownership, ownershipStatus, ownerTeam };
    });
  }

  return NextResponse.json(
    {
      players: enrichedPlayers,
      season,
      total,
      page,
      limit,
    },
    {
      headers: leagueId
        ? { 'Cache-Control': 'private, no-store' }
        : { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    }
  );
});
