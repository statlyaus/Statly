import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';

import { successResponse, errorResponse, commonErrors } from '@/lib/apiResponse';
import { adminAuth } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
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
    } catch (verifyErr) {
      return errorResponse('Unauthorized', 401);
    }

    // Get user's draft history
    const drafts = await prisma.draft.findMany({
      where: {
        OR: [{ status: 'COMPLETED' }, { status: 'PAUSED' }],
        league: {
          members: {
            some: {
              userId: userId,
            },
          },
        },
      },
      include: {
        league: {
          include: {
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    displayName: true,
                  },
                },
              },
            },
          },
        },
        picks: {
          include: {
            player: {
              select: {
                id: true,
                name: true,
                position: true,
                club: true,
              },
            },
            member: {
              include: {
                user: {
                  select: {
                    id: true,
                    displayName: true,
                  },
                },
              },
            },
          },
          orderBy: {
            overall: 'asc',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Transform data for frontend consumption
    const transformedDrafts = drafts.map((draft) => {
      // Group picks by member
      const picksByMember = draft.picks.reduce(
        (acc, pick) => {
          const memberId = pick.member.id;
          if (!acc[memberId]) {
            acc[memberId] = {
              id: memberId,
              displayName: pick.member.user.displayName,
              teamName: pick.member.teamName || `Team ${pick.member.id.slice(0, 8)}`,
              picks: [],
            };
          }

          acc[memberId].picks.push({
            player: {
              name: pick.player.name,
              position: pick.player.position || 'Unknown',
              club: pick.player.club || 'Unknown',
            },
            overall: pick.overall,
            round: pick.round,
          });

          return acc;
        },
        {} as Record<string, any>
      );

      return {
        id: draft.id,
        name: draft.league.name,
        status: draft.status,
        createdAt: draft.createdAt.toISOString(),
        completedAt: draft.completedAt?.toISOString(),
        totalPicks: draft.totalPicks,
        participants: Object.values(picksByMember),
      };
    });

    logger.info('Draft history fetched successfully', {
      userId,
      draftCount: transformedDrafts.length,
    });

    return successResponse(transformedDrafts);
  } catch (error) {
    logger.error('Failed to fetch draft history', {
      error: error instanceof Error ? error.message : String(error),
    });

    return errorResponse('Failed to fetch draft history', 500);
  }
}
