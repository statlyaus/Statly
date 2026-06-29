export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import type { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';

import { errorResponse, successResponse } from '@/lib/apiResponse';
import { tags } from '@/lib/cacheTags';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';

function parsePlayerIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string') return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: leagueId } = await params;
    const userId = await getAuthenticatedUserId(request);
    if (!userId) return errorResponse('Unauthorized', 401);

    const body = (await request.json().catch(() => ({}))) as { playerId?: unknown };
    const playerId = typeof body.playerId === 'string' ? body.playerId.trim() : '';
    if (!leagueId || !playerId) return errorResponse('League ID and player ID are required', 400);

    const [member, player, existingOwnership] = await prisma.$transaction([
      prisma.leagueMember.findFirst({ where: { leagueId, userId }, select: { id: true } }),
      prisma.player.findUnique({ where: { id: playerId }, select: { id: true } }),
      prisma.leagueRosterPlayer.findFirst({
        where: { leagueId, playerId },
        select: { memberId: true },
      }),
    ]);

    if (!member) return errorResponse('User is not a member of this league', 404);
    if (!player) return errorResponse('Player not found', 404);
    if (existingOwnership) return errorResponse('Player already owned in this league', 409);

    const result = await prisma.$transaction(async (tx) => {
      const roster = await tx.leagueRoster.upsert({
        where: { leagueId_memberId: { leagueId, memberId: member.id } },
        create: { leagueId, memberId: member.id, playerIds: JSON.stringify([playerId]) },
        update: {},
      });

      const nextPlayerIds = Array.from(new Set([...parsePlayerIds(roster.playerIds), playerId]));

      await tx.leagueRoster.update({
        where: { leagueId_memberId: { leagueId, memberId: member.id } },
        data: { playerIds: JSON.stringify(nextPlayerIds) },
      });

      await tx.leagueRosterPlayer.create({
        data: {
          leagueId,
          memberId: member.id,
          playerId,
          acquiredBy: 'FREE_AGENT',
        },
      });

      return { rosterId: roster.id, playerIds: nextPlayerIds };
    });

    await Promise.allSettled([revalidateTag(tags.league(leagueId)), revalidateTag(tags.waivers(leagueId))]);

    return successResponse({
      leagueId,
      playerId,
      rosterId: result.rosterId,
      playerIds: result.playerIds,
    });
  } catch (error) {
    logger.error('Failed to add player to roster', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to add player to roster', 500);
  }
}
