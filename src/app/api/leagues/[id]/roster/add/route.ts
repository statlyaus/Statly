export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import type { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';

import { errorResponse, successResponse } from '@/lib/apiResponse';
import { tags } from '@/lib/cacheTags';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import {
  LeagueOwnershipService,
  OwnershipMutationError,
} from '@/server/rosters/LeagueOwnershipService';
import { WaiverAvailabilityProjectionService } from '@/server/waivers/WaiverAvailabilityProjectionService';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: leagueId } = await params;
    const userId = await getAuthenticatedUserId(request);
    if (!userId) return errorResponse('Unauthorized', 401);

    const body = (await request.json().catch(() => ({}))) as { playerId?: unknown };
    const playerId = typeof body.playerId === 'string' ? body.playerId.trim() : '';
    if (!leagueId || !playerId) return errorResponse('League ID and player ID are required', 400);

    const member = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId } },
      select: { id: true },
    });
    if (!member) return errorResponse('User is not a member of this league', 404);

    const result = await new LeagueOwnershipService().addFreeAgent({
      leagueId,
      memberId: member.id,
      playerId,
    });

    await Promise.allSettled([
      new WaiverAvailabilityProjectionService().projectLeague({ leagueId }),
      revalidateTag(tags.league(leagueId)),
      revalidateTag(tags.waivers(leagueId)),
    ]);

    return successResponse({ leagueId, playerId, playerIds: result.playerIds });
  } catch (error) {
    if (error instanceof OwnershipMutationError) {
      const status =
        error.code === 'LEAGUE_NOT_FOUND' ||
        error.code === 'TEAM_NOT_FOUND' ||
        error.code === 'PLAYER_NOT_FOUND'
          ? 404
          : 409;
      return errorResponse(error.message, status);
    }
    logger.error('Failed to add player to roster', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to add player to roster', 500);
  }
}
