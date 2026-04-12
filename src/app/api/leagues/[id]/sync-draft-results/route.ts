import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { leagueRepository } from '@/server/league/repository/LeagueRepository';
export const runtime = 'nodejs';

interface SyncDraftResultsRequest {
  draftId: string;
  finalRosters?: FinalRoster[];
  draftStats?: {
    totalPicks: number;
    draftDuration: number; // in minutes
    averagePickTime: number; // in seconds
    completedAt: string;
  };
}

interface FinalRosterPlayer {
  playerId: string;
  playerName: string;
  position: string;
  club: string;
  pickNumber: number;
  round: number;
}

interface FinalRoster {
  memberId: string;
  userId: string;
  teamName: string;
  players: FinalRosterPlayer[];
}

const paramsSchema = z.object({
  id: z.string().min(1, 'League ID is required'),
});

const bodySchema = z.object({
  draftId: z.string().min(1, 'Draft ID is required'),
  finalRosters: z
    .array(
      z.object({
        memberId: z.string().min(1),
        userId: z.string().min(1),
        teamName: z.string().min(1),
        players: z.array(
          z.object({
            playerId: z.string().min(1),
            playerName: z.string().min(1),
            position: z.string().min(1),
            club: z.string().min(1),
            pickNumber: z.number().int().positive(),
            round: z.number().int().nonnegative(),
          })
        ),
      })
    )
    .optional(),
  draftStats: z
    .object({
      totalPicks: z.number().int().nonnegative(),
      draftDuration: z.number().nonnegative(),
      averagePickTime: z.number().nonnegative(),
      completedAt: z.string().min(1),
    })
    .optional(),
});

function deriveFinalRostersFromDraft(
  draft: {
    picks: Array<{
      memberId: string;
      overall: number;
      round: number;
      playerId: string;
      member: {
        userId: string;
        teamName: string;
      };
      player: {
        name: string;
        position: string;
        club: string;
      } | null;
    }>;
    league: {
      members: Array<{
        id: string;
        userId: string;
        teamName: string;
      }>;
    };
  },
  finalRosters?: FinalRoster[]
) {
  if (finalRosters && finalRosters.length > 0) {
    return finalRosters;
  }

  const picksByMemberId = new Map<string, FinalRoster>();
  for (const pick of draft.picks) {
    const existing = picksByMemberId.get(pick.memberId) ?? {
      memberId: pick.memberId,
      userId: pick.member.userId,
      teamName: pick.member.teamName,
      players: [],
    };
    existing.players.push({
      playerId: String(pick.playerId),
      playerName: pick.player?.name ?? String(pick.playerId),
      position: pick.player?.position ?? '',
      club: pick.player?.club ?? '',
      pickNumber: pick.overall,
      round: pick.round,
    });
    picksByMemberId.set(pick.memberId, existing);
  }

  return draft.league.members.map((member) => {
    const existing = picksByMemberId.get(member.id);
    return (
      existing ?? {
        memberId: member.id,
        userId: member.userId,
        teamName: member.teamName,
        players: [],
      }
    );
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return errorResponse('League ID is required', 400);
  }
  const { id: leagueId } = parsedParams.data;
  try {
    const rawBody = (await request.json().catch(() => null)) as unknown;
    const parsedBody = bodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return errorResponse('Invalid sync payload', 400);
    }
    const body = parsedBody.data as SyncDraftResultsRequest;

    const prismaLeague = await prisma.league.findUnique({
      where: { id: leagueId },
      include: {
        members: true,
        settings: true,
      },
    });

    if (!prismaLeague) {
      return errorResponse('League not found', 404);
    }

    const draft = await prisma.draft.findUnique({
      where: { id: body.draftId },
      include: {
        picks: {
          include: {
            member: true,
            player: true,
          },
          orderBy: { overall: 'asc' },
        },
        league: {
          include: {
            members: true,
          },
        },
      },
    });

    if (!draft || draft.leagueId !== leagueId) {
      return errorResponse('Draft not found or does not belong to this league', 404);
    }

    const normalizedRosters = deriveFinalRostersFromDraft(draft, body.finalRosters);
    const memberIds = new Set(prismaLeague.members.map((member) => member.id));
    const invalidRoster = normalizedRosters.find(
      (roster: FinalRoster) => !memberIds.has(roster.memberId)
    );
    if (invalidRoster) {
      return errorResponse('Roster payload contains a member outside this league', 400);
    }

    await prisma.$transaction(async (tx) => {
      await tx.draft.update({
        where: { id: body.draftId },
        data: {
          status: 'COMPLETED',
          completedAt: body.draftStats?.completedAt
            ? new Date(body.draftStats.completedAt)
            : new Date(),
        },
      });

      await tx.league.update({
        where: { id: leagueId },
        data: {
          status: 'active',
        },
      });

      if (prismaLeague.settings) {
        await tx.leagueSettings.update({
          where: { id: prismaLeague.settings.id },
          data: {
            locked: true,
          },
        });
      }

      for (const roster of normalizedRosters) {
        await tx.leagueMember.update({
          where: { id: roster.memberId },
          data: {
            teamName: roster.teamName,
          },
        });

        await leagueRepository.updateMemberRoster(tx, {
          leagueId,
          memberId: roster.memberId,
          playerIds: roster.players.map((player: FinalRosterPlayer) => player.playerId),
        });

        logger.info('Roster synced for member', {
          memberId: roster.memberId,
          playerCount: roster.players.length,
          leagueId,
        });
      }
    });

    logger.info('Draft results synced to Prisma league', {
      leagueId,
      draftId: body.draftId,
      totalPicks: body.draftStats?.totalPicks,
      rosterCount: normalizedRosters.length,
    });

    return successResponse({
      message: 'Draft results successfully synced to league',
      leagueId,
      draftId: body.draftId,
      syncedRosters: normalizedRosters.length,
      leagueStatus: 'active',
    });
  } catch (error) {
    logger.error('Failed to sync draft results to league', {
      leagueId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return errorResponse('Failed to sync draft results', 500);
  }
}
