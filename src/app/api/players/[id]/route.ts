export const runtime = 'nodejs';

import { type NextRequest } from 'next/server';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { verifyLeagueMembership } from '@/lib/leagueMembership';
import { getLeagueOwnershipMap } from '@/lib/leagueOwnership';
import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { getPlayerDetail } from '@/server/players/getPlayerDetail';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  let playerIdForLog = 'unknown';
  try {
    const { id } = await context.params;
    playerIdForLog = id;
    const leagueId = new URL(request.url).searchParams.get('leagueId') || undefined;

    let responsePlayer = await getPlayerDetail(id);

    if (!responsePlayer) {
      return commonErrors.notFound('Player not found');
    }

    if (leagueId) {
      const uid = await getAuthenticatedUserId(request);
      if (!uid) return commonErrors.unauthorized();
      const membership = await verifyLeagueMembership(leagueId, uid);
      if (!membership.isMember) return commonErrors.forbidden('Forbidden');
      const { totalTeams, counts } = await getLeagueOwnershipMap(leagueId, [responsePlayer.id]);
      const count = counts.get(responsePlayer.id) ?? 0;
      const ownership = totalTeams > 0 ? Math.round((count / totalTeams) * 100) : 0;
      responsePlayer = { ...responsePlayer, ownership };
    }

    return successResponse(responsePlayer);
  } catch (error) {
    logger.error('Failed to fetch player', error, { playerId: playerIdForLog });
    return commonErrors.internalServerError('Failed to fetch player');
  }
}
