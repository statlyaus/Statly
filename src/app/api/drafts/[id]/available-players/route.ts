import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { getDefaultAflSeason } from '@/lib/aflSeason';
import { createSuccessResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { buildCanonicalPlayerId } from '@/lib/playerIdentity';
import { prisma } from '@/lib/prisma';
import { CANONICAL_STAT_KEYS, type CanonicalStatKey } from '@/lib/stats/statColumns';
import { normalizeTeamName } from '@shared/player-identity/teamNames';
import {
  ensurePlayerSeasonSummariesMaterialized,
  getPlayerSeasonSummaryMap,
  resolveLatestProjectedSeason,
} from '@/server/readModels/playerReadModels';
import { FANTASY_CATEGORIES, type FantasyCategoryKey } from '@/types/fantasyCategories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function buildEmptyStats(): Record<CanonicalStatKey, number> {
  const empty = {} as Record<CanonicalStatKey, number>;
  for (const key of CANONICAL_STAT_KEYS) {
    empty[key] = 0;
  }
  return empty;
}

function parseSelectedCategories(raw: unknown): FantasyCategoryKey[] {
  let parsed: unknown = raw;

  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw.split(',').map((value) => value.trim());
    }
  }

  if (!Array.isArray(parsed)) return [];

  const validKeys = new Set(Object.keys(FANTASY_CATEGORIES));
  return parsed.map(String).filter((value): value is FantasyCategoryKey => validKeys.has(value));
}

type DraftBoardPlayer = { id: string; name: string; position: string; club: string };

function draftPlayerIdentityKey(player: { name: string; club: string }): string {
  return `${buildCanonicalPlayerId(player.name)}|${normalizeTeamName(player.club)}`;
}

function canonicalPreference(player: DraftBoardPlayer): number {
  const canonicalId = buildCanonicalPlayerId(player.name);
  if (player.id === canonicalId) return 3;
  if (!player.id.startsWith('ply_') && !player.id.includes('-')) return 2;
  if (!player.id.startsWith('ply_')) return 1;
  return 0;
}

function chooseCanonicalPlayer(current: DraftBoardPlayer | undefined, next: DraftBoardPlayer) {
  if (!current) return next;

  const currentPreference = canonicalPreference(current);
  const nextPreference = canonicalPreference(next);
  if (nextPreference !== currentPreference) {
    return nextPreference > currentPreference ? next : current;
  }

  return next.id.localeCompare(current.id) < 0 ? next : current;
}

// GET /api/drafts/[id]/available-players?page=1&pageSize=100
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: draftId } = await params;

    if (!draftId || typeof draftId !== 'string') {
      return errorResponse('Invalid draft id', 400);
    }

    const url = new URL(request.url);
    const queryObj = Object.fromEntries(url.searchParams.entries());
    const QuerySchema = z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(100),
      sort: z.enum(['tier', 'averagePoints', 'name']).optional(),
      order: z.enum(['asc', 'desc']).optional(),
    });
    const parsed = QuerySchema.safeParse(queryObj);
    if (!parsed.success) {
      return errorResponse('Invalid query parameters', 400, 'BAD_REQUEST', {
        issues: parsed.error.issues,
      });
    }

    const { page, pageSize, sort = 'name', order = 'asc' } = parsed.data;

    const [draft, picks] = await Promise.all([
      prisma.draft.findUnique({
        where: { id: draftId },
        select: {
          league: {
            select: {
              categoriesJson: true,
            },
          },
        },
      }),
      prisma.pick.findMany({ where: { draftId }, select: { playerId: true } }),
    ]);

    if (!draft) {
      return errorResponse('Draft not found', 404);
    }

    const selectedCategories = parseSelectedCategories(draft.league?.categoriesJson);
    const pickedIds = picks.map((pick) => pick.playerId);
    const exactPickedWhere: Prisma.PlayerWhereInput =
      pickedIds.length > 0 ? { id: { in: pickedIds } } : { id: { in: [] } };
    const activeWhere: Prisma.PlayerWhereInput = { active: true };
    const pickedPlayers =
      pickedIds.length > 0
        ? await prisma.player.findMany({
            where: exactPickedWhere,
            select: { id: true, name: true, position: true, club: true },
          })
        : [];
    const pickedIdentityKeys = new Set(pickedPlayers.map(draftPlayerIdentityKey));

    const season = await resolveLatestProjectedSeason(prisma, getDefaultAflSeason());
    await ensurePlayerSeasonSummariesMaterialized(prisma, season);

    const activePlayers = await prisma.player.findMany({
      where: activeWhere,
      select: { id: true, name: true, position: true, club: true },
    });
    const byIdentity = new Map<string, DraftBoardPlayer>();

    for (const player of activePlayers) {
      const key = draftPlayerIdentityKey(player);
      if (pickedIdentityKeys.has(key)) continue;
      byIdentity.set(key, chooseCanonicalPlayer(byIdentity.get(key), player));
    }

    const dedupedPlayers = [...byIdentity.values()];
    const statsById = await getPlayerSeasonSummaryMap(
      prisma,
      season,
      dedupedPlayers.map((player) => player.id)
    );

    dedupedPlayers.sort((left, right) => {
      if (sort === 'averagePoints' || sort === 'tier') {
        const field = sort === 'averagePoints' ? 'averageScore' : 'totalValue';
        const leftValue = statsById.get(left.id)?.[field] ?? null;
        const rightValue = statsById.get(right.id)?.[field] ?? null;
        if (leftValue !== rightValue) {
          if (leftValue === null) return 1;
          if (rightValue === null) return -1;
          return order === 'asc' ? leftValue - rightValue : rightValue - leftValue;
        }
      }

      return order === 'asc'
        ? left.name.localeCompare(right.name)
        : right.name.localeCompare(left.name);
    });

    const totalCount = dedupedPlayers.length;
    const skip = (page - 1) * pageSize;
    const players = dedupedPlayers.slice(skip, skip + pageSize);

    const data = {
      draftId,
      selectedCategories,
      pagination: {
        page,
        pageSize,
        skip,
        totalCount,
        hasMore: players.length === pageSize,
      },
      players: players.map((player) => {
        const summary = statsById.get(player.id);
        const stats = summary?.stats ?? buildEmptyStats();

        return {
          id: player.id,
          name: player.name,
          position: player.position,
          club: player.club,
          tier: summary?.totalValue ?? null,
          avgPoints: summary?.averageScore ?? null,
          averagePoints: summary?.averageScore ?? null,
          isAvailable: true,
          stats,
          statsTotal: summary?.totals ?? undefined,
          gamesPlayed: summary?.gamesPlayed ?? 0,
        };
      }),
    };

    logger.info('Available players retrieved', {
      draftId,
      page,
      pageSize,
      count: players.length,
      totalCount,
      selectedCategories,
    });

    return NextResponse.json(createSuccessResponse(data), {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch (error) {
    logger.error('Failed to retrieve available players', {
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return errorResponse('Failed to retrieve available players', 500);
  }
}
