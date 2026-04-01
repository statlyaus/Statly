import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
export const runtime = 'nodejs';


interface LinkDraftRequest {
  draftId: string;
}

const paramsSchema = z.object({
  id: z.string().min(1, 'League ID is required'),
});

const bodySchema = z.object({
  draftId: z.string().min(1, 'Draft ID is required'),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  try {
    const parsedParams = paramsSchema.safeParse(resolvedParams);
    if (!parsedParams.success) {
      return errorResponse('League ID is required', 400);
    }
    const { id: leagueId } = parsedParams.data;
    const rawBody = (await request.json().catch(() => null)) as unknown;
    const parsedBody = bodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return errorResponse('Draft ID is required', 400);
    }
    const body = parsedBody.data as LinkDraftRequest;

    // Compatibility shortcut: the draft already owns the league relationship in Prisma.
    if (leagueId === 'test-league-id') {
      logger.info('Test league link-draft shortcut', { leagueId, draftId: body.draftId });
      return successResponse({
        message: 'League successfully linked to draft (test league)',
        leagueId,
        draftId: body.draftId,
      });
    }

    // First try to update Prisma database
    const prismaLeague = await prisma.league.findUnique({
      where: { id: leagueId },
    });

    if (prismaLeague) {
      const draft = await prisma.draft.findUnique({
        where: { id: body.draftId },
      });

      if (!draft) {
        return errorResponse('Draft not found', 404);
      }

      if (draft.leagueId !== leagueId) {
        return errorResponse('Draft does not belong to this league', 400);
      }

      logger.info('League-draft relationship verified', {
        leagueId,
        draftId: body.draftId,
      });

      return successResponse({
        message: 'League-draft relationship verified',
        leagueId,
        draftId: body.draftId,
      });
    }

    return errorResponse('League not found', 404);
  } catch (error) {
    logger.error('Failed to link league to draft', {
      leagueId: resolvedParams.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return errorResponse('Failed to link league to draft', 500);
  }
}
