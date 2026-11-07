export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { createErrorResponse, errorResponse, successResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { resolveCanonicalPlayerId } from '@/server/players/playerIdentityService';
import { WaiverAvailabilityProjectionService } from '@/server/waivers/WaiverAvailabilityProjectionService';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: leagueId } = await params;
    const userId = await getAuthenticatedUserId(request);
    if (!userId) return errorResponse('Unauthorized', 401);

    const body = (await request.json().catch(() => ({}))) as { playerId?: unknown };
    const requestedPlayerId = typeof body.playerId === 'string' ? body.playerId.trim() : '';
    if (!leagueId || !requestedPlayerId)
      return errorResponse('League ID and player ID are required', 400);
    const playerId = await resolveCanonicalPlayerId(requestedPlayerId);
    if (!playerId) {
      return NextResponse.json(createErrorResponse('Player not found', 'NOT_FOUND'), {
        status: 404,
      });
    }

    const [member, player, existingOwnership, activeWaiverHold] = await prisma.$transaction([
      prisma.leagueMember.findFirst({ where: { leagueId, userId }, select: { id: true } }),
      prisma.player.findUnique({ where: { id: playerId }, select: { id: true } }),
      prisma.leagueRosterPlayer.findFirst({
        where: { leagueId, playerId },
        select: { memberId: true },
      }),
      prisma.teamAction.findFirst({
        where: {
          leagueId,
          actionType: 'DROP_PLAYER',
          status: 'PENDING',
          processingAt: { gt: new Date() },
          details: { path: ['playerId'], equals: playerId },
        },
        select: { id: true },
      }),
    ]);

    if (!member) return errorResponse('User is not a member of this league', 404);
    if (!player) {
      return NextResponse.json(createErrorResponse('Player not found', 'NOT_FOUND'), {
        status: 404,
      });
    }
    if (existingOwnership) return errorResponse('Player already owned in this league', 409);
    if (activeWaiverHold) return errorResponse('Player is on waivers', 409);

    const rosterPlayer = await prisma.leagueRosterPlayer.create({
      data: {
        leagueId,
        memberId: member.id,
        playerId,
        acquiredBy: 'FREE_AGENT',
      },
    });

    const playerIds = await prisma.leagueRosterPlayer.findMany({
      where: { leagueId, memberId: member.id },
      select: { playerId: true },
      orderBy: [{ acquiredAt: 'asc' }, { createdAt: 'asc' }],
    });

    await Promise.allSettled([
      new WaiverAvailabilityProjectionService().projectLeague({ leagueId }),
    ]);

    return successResponse({
      leagueId,
      playerId,
      rosterId: rosterPlayer.id,
      playerIds: playerIds.map((p) => p.playerId),
    });
  } catch (error) {
    logger.error('Failed to add player to roster', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to add player to roster', 500);
  }
}
