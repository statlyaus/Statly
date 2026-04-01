import type { NextRequest } from 'next/server';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { getDefaultAflSeason } from '@/lib/aflSeason';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { leagueApplicationService } from '@/server/league/services/LeagueApplicationService';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUserId = await getAuthenticatedUserId(request);
    if (!authUserId) return commonErrors.unauthorized();

    const { id: leagueId } = await params;
    const membership = await prisma.leagueMember.findFirst({
      where: { leagueId, userId: authUserId },
      select: { id: true },
    });
    if (!membership) return commonErrors.forbidden('You are not a member of this league');

    const seasonParam = new URL(request.url).searchParams.get('season');
    const season = seasonParam ? Number(seasonParam) : getDefaultAflSeason();
    if (!Number.isFinite(season)) {
      return commonErrors.badRequest('Season must be a number');
    }
    const state = await leagueApplicationService.getLeagueSeasonState({ leagueId, season });
    const ladder = state.ladder.map((entry) => ({
      ...entry,
      isCurrentUser: entry.userId === authUserId,
    }));

    return successResponse({
      leagueId: state.leagueId,
      season: state.season,
      currentWeek: state.currentWeek,
      schedule: state.schedule,
      ladder,
    });
  } catch (error) {
    logger.error('Failed to load league season state', {
      error: error instanceof Error ? error.message : String(error),
    });
    return commonErrors.internalServerError('Failed to load league season state');
  }
}
