import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { adminAuth } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: draftId } = await params;

    // Verify user authentication
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('statly_session')?.value;

    if (!sessionCookie) {
      return errorResponse('Unauthorized', 401);
    }

    let userId: string;
    try {
      const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
      userId = decoded.uid;
    } catch (_verifyErr) {
      return errorResponse('Unauthorized', 401);
    }

    // Get draft and verify user is league member
    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        league: {
          include: {
            members: true,
          },
        },
        picks: {
          include: {
            player: true,
            member: {
              include: {
                user: true,
              },
            },
          },
          orderBy: { overall: 'asc' },
        },
      },
    });

    if (!draft) {
      return errorResponse('Draft not found', 404);
    }

    // Check if user is league member
    const isMember = draft.league.members.some((member) => member.userId === userId);

    if (!isMember) {
      return errorResponse('Forbidden', 403);
    }

    // Format picks for history
    const picks = draft.picks.map((pick) => ({
      id: pick.id,
      overall: pick.overall,
      round: pick.round,
      slot: pick.slot,
      player: {
        id: pick.player.id,
        name: pick.player.name,
        position: pick.player.position,
        club: pick.player.club,
      },
      member: {
        id: pick.member.id,
        teamName: pick.member.teamName,
        user: {
          id: pick.member.user.id,
          displayName: pick.member.user.displayName,
          email: pick.member.user.email,
        },
      },
      auto: pick.auto,
      madeAt: pick.madeAt,
    }));

    logger.info('Draft history retrieved', {
      draftId,
      userId,
      pickCount: picks.length,
    });

    return successResponse({
      draft: {
        id: draft.id,
        status: draft.status,
        currentPick: draft.currentPick,
        totalPicks: draft.totalPicks,
        startedAt: draft.startedAt,
        completedAt: draft.completedAt,
      },
      picks,
    });
  } catch (error) {
    logger.error('Failed to get draft history', {
      draftId: (await params).id,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse('Failed to get draft history', 500);
  }
}
