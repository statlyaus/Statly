import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

/**
 * List all drafts for debugging
 */
export async function GET(_request: NextRequest) {
  try {
    const drafts = await prisma.draft.findMany({
      select: {
        id: true,
        status: true,
        createdAt: true,
        league: {
          select: {
            id: true,
            name: true,
            settings: {
              select: {
                startAt: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 10, // Last 10 drafts
    });

    const result = {
      count: drafts.length,
      drafts: drafts.map(draft => ({
        id: draft.id,
        status: draft.status,
        leagueName: draft.league?.name || 'Unknown',
        startAt: draft.league?.settings?.startAt,
        createdAt: draft.createdAt,
      })),
    };

    logger.info('Listed drafts', { count: drafts.length });

    return successResponse(result);
  } catch (error) {
    logger.error('Failed to list drafts', {
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse('Failed to list drafts', 500);
  }
}
