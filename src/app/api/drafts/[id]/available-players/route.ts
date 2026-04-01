import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { getDefaultAflSeason } from '@/lib/aflSeason';
import { createSuccessResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { CANONICAL_STAT_KEYS, type CanonicalStatKey } from '@/lib/stats/statColumns';
import {
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
  return parsed
    .map(String)
    .filter((value): value is FantasyCategoryKey => validKeys.has(value));
}

// GET /api/drafts/[id]/available-players?page=1&pageSize=100
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const where: Prisma.PlayerWhereInput =
      pickedIds.length > 0 ? { active: true, id: { notIn: pickedIds } } : { active: true };

    const skip = (page - 1) * pageSize;
    const season = await resolveLatestProjectedSeason(prisma, getDefaultAflSeason());

    let players: Array<{ id: string; name: string; position: string; club: string }> = [];
    let totalCount = 0;

    if (sort === 'averagePoints' || sort === 'tier') {
      const orderByField = sort === 'averagePoints' ? 'averageScore' : 'totalValue';
      const [summaryRows, summaryCount, playerCount] = await Promise.all([
        prisma.playerSeasonSummary.findMany({
          where: {
            season,
            player: where,
          },
          orderBy: { [orderByField]: order },
          skip,
          take: pageSize,
          select: {
            playerId: true,
            playerName: true,
            club: true,
            position: true,
          },
        }),
        prisma.playerSeasonSummary.count({
          where: {
            season,
            player: where,
          },
        }),
        prisma.player.count({ where }),
      ]);

      players = summaryRows.map((row) => ({
        id: row.playerId,
        name: row.playerName,
        position: row.position,
        club: row.club,
      }));
      totalCount = playerCount;

      const remaining = pageSize - players.length;
      if (remaining > 0) {
        const unsummarizedSkip = Math.max(0, skip - summaryCount);
        const unsummarizedPlayers = await prisma.player.findMany({
          where: {
            ...where,
            seasonSummaries: {
              none: {
                season,
              },
            },
          },
          orderBy: { name: 'asc' },
          skip: unsummarizedSkip,
          take: remaining,
        });

        players = players.concat(
          unsummarizedPlayers.map((player) => ({
            id: player.id,
            name: player.name,
            position: player.position,
            club: player.club,
          }))
        );
      }
    } else {
      const [dbPlayers, playerCount] = await Promise.all([
        prisma.player.findMany({ where, orderBy: { name: order }, skip, take: pageSize }),
        prisma.player.count({ where }),
      ]);
      players = dbPlayers.map((player) => ({
        id: player.id,
        name: player.name,
        position: player.position,
        club: player.club,
      }));
      totalCount = playerCount;
    }

    const playerIds = players.map((player) => player.id);
    const statsById = await getPlayerSeasonSummaryMap(prisma, season, playerIds);

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
