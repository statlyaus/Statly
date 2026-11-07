import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import {
  normalizeFantasyCategoryKeys,
  REAL_DATA_NINE_CATEGORY_PRESET,
  type FantasyCategoryKey,
} from '@/types/fantasyCategories';

function normalizeCategories(value: unknown): FantasyCategoryKey[] {
  return normalizeFantasyCategoryKeys(value, REAL_DATA_NINE_CATEGORY_PRESET);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
): Promise<NextResponse> {
  try {
    const { userId } = await params;

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          leagues: [],
          error: 'User ID is required',
        },
        { status: 400 }
      );
    }

    const authenticatedUserId = await getAuthenticatedUserId(request);
    if (!authenticatedUserId) {
      return NextResponse.json(
        { success: false, leagues: [], error: 'Unauthorized' },
        { status: 401 }
      );
    }

    if (authenticatedUserId !== userId) {
      return NextResponse.json(
        { success: false, leagues: [], error: 'Forbidden' },
        { status: 403 }
      );
    }

    // Prisma is the only league authority. A league with no Prisma row is legacy data and is not
    // listed; Firestore league documents are never read here.
    const prismaMemberships = await prisma.leagueMember.findMany({
      where: { userId, isActive: true },
      include: {
        league: {
          include: {
            settings: true,
            drafts: { orderBy: { createdAt: 'desc' }, take: 1 },
            _count: { select: { members: { where: { isActive: true } } } },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    const leagues = prismaMemberships.map((membership) => {
      const league = membership.league;
      const draft = league.drafts[0] ?? null;

      return {
        id: league.id,
        name: league.name,
        teamName: membership.teamName,
        status:
          draft?.status === 'COMPLETED'
            ? 'completed'
            : draft?.status === 'LIVE' || draft?.status === 'PAUSED'
              ? 'active'
              : 'preseason',
        draftCompleted: draft?.status === 'COMPLETED',
        memberCount: league._count.members,
        maxTeams: league.settings.maxTeams,
        description: `${league.name} Fantasy League`,
        ownerId: league.ownerId,
        type: 'private',
        code: league.inviteCode,
        categories: normalizeCategories(league.categoriesJson),
        draftDate: league.settings.startAt?.toISOString(),
        createdAt: league.createdAt.toISOString(),
        updatedAt: league.createdAt.toISOString(),
      };
    });

    logger.info('Returning Prisma league memberships', { userId, count: leagues.length });
    return NextResponse.json({
      success: true,
      leagues,
    });
  } catch (error) {
    logger.error('Error fetching user league memberships:', error);
    return NextResponse.json(
      {
        success: false,
        leagues: [],
        error: 'Failed to fetch user league memberships',
      },
      { status: 500 }
    );
  }
}
