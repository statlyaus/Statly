import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { adminDb } from '@/lib/firebaseAdmin';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { getLeagueMembership, isLeagueManagerRole } from '@/lib/leagueMembership';

interface SyncDraftResultsRequest {
  draftId: string;
  finalRosters?: Array<{
    memberId: string;
    userId: string;
    teamName: string;
    players: Array<{
      playerId: string;
      playerName: string;
      position: string;
      club: string;
      pickNumber: number;
      round: number;
    }>;
  }>;
  draftStats?: {
    totalPicks: number;
    draftDuration: number; // in minutes
    averagePickTime: number; // in seconds
    completedAt: string;
  };
}

async function authorizeDraftResultsSync(request: NextRequest, leagueId: string) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return errorResponse('Unauthorized', 401);
  }

  const membership = await getLeagueMembership(leagueId, userId);
  if (!membership.isMember || !isLeagueManagerRole(membership.data?.role)) {
    return errorResponse('Forbidden', 403);
  }

  return null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: leagueId } = await params;
    const body: SyncDraftResultsRequest = await request.json();

    if (!body.draftId?.trim()) {
      return errorResponse('Draft ID is required', 400);
    }

    const authError = await authorizeDraftResultsSync(request, leagueId);
    if (authError) {
      return authError;
    }

    // First try to sync with Prisma database
    const prismaLeague = await prisma.league.findUnique({
      where: { id: leagueId },
      include: {
        members: true,
      },
    });

    if (prismaLeague) {
      // Find the draft associated with this league
      const draft = await prisma.draft.findUnique({
        where: { id: body.draftId },
        include: {
          picks: {
            include: {
              member: true,
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

      // Sync draft completion status
      await prisma.draft.update({
        where: { id: body.draftId },
        data: {
          status: 'COMPLETED',
          completedAt: body.draftStats?.completedAt
            ? new Date(body.draftStats.completedAt)
            : new Date(),
        },
      });

      // Create team rosters based on draft picks
      if (body.finalRosters && body.finalRosters.length > 0) {
        await prisma.$transaction(async (tx) => {
          for (const roster of body.finalRosters!) {
            // Update league member with final team composition
            await tx.leagueMember.update({
              where: { id: roster.memberId },
              data: {
                teamName: roster.teamName,
                // You could add additional fields here for roster metadata
              },
            });

            // Store roster data in a separate table if needed
            // This is where you'd integrate with your team/roster management system
            logger.info('Roster synced for member', {
              memberId: roster.memberId,
              playerCount: roster.players.length,
              leagueId,
            });
          }
        });
      }

      // Update league status to reflect draft completion
      await prisma.$transaction(async (tx) => {
        // Mark league as active since draft is complete
        const leagueRef = await tx.league.findUnique({
          where: { id: leagueId },
          include: { settings: true },
        });

        if (leagueRef?.settings) {
          await tx.leagueSettings.update({
            where: { id: leagueRef.settings.id },
            data: {
              locked: true, // Lock settings after draft
            },
          });
        }
      });

      logger.info('Draft results synced to Prisma league', {
        leagueId,
        draftId: body.draftId,
        totalPicks: body.draftStats?.totalPicks,
        rosterCount: body.finalRosters?.length,
      });

      return successResponse({
        message: 'Draft results successfully synced to league',
        leagueId,
        draftId: body.draftId,
        syncedRosters: body.finalRosters?.length || 0,
        leagueStatus: 'active',
      });
    }

    // Handle Firebase leagues as fallback
    const leagueRef = adminDb.collection('leagues').doc(leagueId);
    const leagueDoc = await leagueRef.get();

    if (!leagueDoc.exists) {
      return errorResponse('League not found', 404);
    }

    const batch = adminDb.batch();

    // Update league with draft completion status
    batch.update(leagueRef, {
      draftCompleted: true,
      draftCompletedAt: body.draftStats?.completedAt || new Date().toISOString(),
      draftStats: body.draftStats || null,
      status: 'active', // Move league to active status
      updatedAt: new Date(),
    });

    // Store league rosters for live roster views and waiver processing.
    if (body.finalRosters) {
      for (const roster of body.finalRosters) {
        const now = new Date();
        const rosterRef = leagueRef.collection('rosters').doc(roster.memberId);

        batch.set(
          rosterRef,
          {
            leagueId,
            memberId: roster.memberId,
            userId: roster.userId,
            teamName: roster.teamName,
            playerIds: roster.players.map((player) => String(player.playerId)),
            players: roster.players,
            bench: [],
            emergencies: [],
            draftedAt: now,
            createdAt: now,
            updatedAt: now,
          },
          { merge: true }
        );
      }
    }

    // Commit all changes
    await batch.commit();

    logger.info('Draft results synced to Firebase league', {
      leagueId,
      draftId: body.draftId,
      totalPicks: body.draftStats?.totalPicks,
      rosterCount: body.finalRosters?.length,
    });

    return successResponse({
      message: 'Draft results successfully synced to league',
      leagueId,
      draftId: body.draftId,
      syncedRosters: body.finalRosters?.length || 0,
      leagueStatus: 'active',
    });
  } catch (error) {
    logger.error('Failed to sync draft results to league', {
      leagueId: (await params).id,
      draftId: (await request.json()).draftId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return errorResponse('Failed to sync draft results', 500);
  }
}
