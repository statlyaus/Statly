import { z } from 'zod';

import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

    // Find picked players for this draft
    const picks = await prisma.pick.findMany({ where: { draftId }, select: { playerId: true } });
    const pickedIds = picks.map((p) => p.playerId);

    // Query available players (active and not picked)
    const where =
      pickedIds.length > 0 ? { active: true, id: { notIn: pickedIds } } : { active: true };

    const orderBy =
      sort === 'tier'
        ? { tier: order }
        : sort === 'averagePoints'
          ? { averagePoints: order }
          : ({ name: order } as const);

    const skip = (page - 1) * pageSize;

    const [players, totalCount] = await Promise.all([
      prisma.player.findMany({ where, orderBy, skip, take: pageSize }),
      prisma.player.count({ where }),
    ]);

    const data = {
      draftId,
      pagination: {
        page,
        pageSize,
        skip,
        totalCount,
        hasMore: players.length === pageSize,
      },
      players: players.map((p) => ({
        id: p.id,
        name: p.name,
        position: p.position,
        club: p.club,
        tier: (p as any).tier ?? null,
        averagePoints: (p as any).averagePoints ?? null,
      })),
    };

    logger.info('Available players retrieved', {
      draftId,
      page,
      pageSize,
      count: players.length,
      totalCount,
    });
    return successResponse(data);
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
