import { successResponse, errorResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { adminAuth } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  let userId: string | undefined;

  try {
    // Verify user authentication
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('statly_session')?.value;

    if (!sessionCookie) {
      return errorResponse('Unauthorized', 401);
    }

    try {
      const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
      userId = decoded.uid;
    } catch (_verifyErr) {
      return errorResponse('Unauthorized', 401);
    }

    const drafts = await prisma.draft.findMany({
      where: {
        status: 'COMPLETED',
        league: {
          members: {
            some: { userId },
          },
        },
      },
      include: {
        league: {
          include: {
            members: {
              include: {
                user: true,
              },
              orderBy: { draftSlot: 'asc' },
            },
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
      orderBy: { completedAt: 'desc' },
    });

    const draftHistory = drafts.map((draft) => ({
      id: draft.id,
      name: draft.league.name,
      status: draft.status,
      createdAt: draft.createdAt.toISOString(),
      completedAt: draft.completedAt?.toISOString(),
      totalPicks: draft.totalPicks,
      participants: draft.league.members.map((member) => ({
        id: member.id,
        displayName: member.user.displayName,
        teamName: member.teamName,
        picks: draft.picks
          .filter((pick) => pick.memberId === member.id)
          .map((pick) => ({
            player: {
              name: pick.player.name,
              position: pick.player.position,
              club: pick.player.club,
            },
            overall: pick.overall,
            round: pick.round,
          })),
      })),
    }));

    logger.info('Draft history retrieved', {
      userId,
      draftCount: draftHistory.length,
    });

    return successResponse(draftHistory);
  } catch (error) {
    logger.error('Failed to get draft history', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse('Failed to get draft history', 500);
  }
}
