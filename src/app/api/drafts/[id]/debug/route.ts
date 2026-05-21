import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { authorizeLocalOnlyRequest } from '@/lib/operationalAuth';

const paramsSchema = z.object({
  id: z.string().min(1, 'Draft ID is required'),
});

/**
 * Debug endpoint to check draft data structure
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authorization = authorizeLocalOnlyRequest();
  if (!authorization.ok) return authorization.response;

  const resolvedParams = await params;
  try {
    const parsedParams = paramsSchema.safeParse(resolvedParams);
    if (!parsedParams.success) {
      return errorResponse('Invalid draft ID', 400);
    }
    const { id: draftId } = parsedParams.data;
    const { prisma } = await import('@/lib/prisma');

    // First, check if draft exists at all
    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
    });

    if (!draft) {
      return errorResponse('Draft not found', 404);
    }

    // Get full draft data with relations
    const fullDraft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        league: {
          include: {
            settings: true,
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    displayName: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
        picks: {
          include: {
            player: {
              select: {
                id: true,
                name: true,
                position: true,
                club: true,
              },
            },
          },
        },
      },
    });

    // Check what columns exist on the draft table
    const draftColumns = Object.keys(draft);

    const debugInfo = {
      draftExists: !!draft,
      draftId: draft.id,
      draftStatus: draft.status,
      draftColumns,
      hasLobbyStatus: 'lobbyStatus' in draft,
      hasLobbyOpenAt: 'lobbyOpenAt' in draft,
      leagueExists: !!fullDraft?.league,
      settingsExist: !!fullDraft?.league?.settings,
      startTime: fullDraft?.league?.settings?.startAt,
      membersCount: fullDraft?.league?.members?.length || 0,
      picksCount: fullDraft?.picks?.length || 0,
      fullDraftStructure: fullDraft,
    };

    logger.info('Draft debug info', debugInfo);

    return successResponse(debugInfo);
  } catch (error) {
    logger.error('Failed to get debug info', {
      draftId: resolvedParams.id,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return errorResponse('Failed to get debug info', 500);
  }
}
