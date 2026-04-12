import type { NextRequest } from 'next/server';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { getDefaultAflSeason } from '@/lib/aflSeason';
import { isAuthBypassEnabled } from '@/lib/authBypass';
import { bootstrapLeagueSeason } from '@/lib/leagueSeason';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let leagueId = '';
  let season = getDefaultAflSeason();

  try {
    const authUserId = await getAuthenticatedUserId(request);
    if (!authUserId && !isAuthBypassEnabled()) {
      return commonErrors.unauthorized();
    }

    const resolvedParams = await params;
    leagueId = resolvedParams.id;
    if (!leagueId) {
      return commonErrors.badRequest('League ID is required');
    }

    const body = (await request.json().catch(() => ({ season: getDefaultAflSeason() }))) as {
      season?: number;
    };
    season = Number(body.season ?? getDefaultAflSeason());
    if (!Number.isFinite(season)) {
      return commonErrors.badRequest('A valid season is required');
    }

    if (!isAuthBypassEnabled() && authUserId) {
      const membership = await prisma.leagueMember.findFirst({
        where: { leagueId, userId: authUserId },
        select: { id: true },
      });
      if (!membership) {
        return commonErrors.forbidden('You are not a member of this league');
      }
    }

    const result = await bootstrapLeagueSeason({ leagueId, season });
    return successResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('does not have enough members') ||
      message.includes('does not have scoring categories configured')
    ) {
      return successResponse({
        leagueId,
        season,
        matchupCount: 0,
        weekCount: 0,
        currentWeek: null,
        standingsCount: 0,
        skipped: true,
        reason: message,
      });
    }
    logger.error('Failed to bootstrap league season', {
      error: message,
    });
    return commonErrors.internalServerError('Failed to bootstrap league season');
  }
}
