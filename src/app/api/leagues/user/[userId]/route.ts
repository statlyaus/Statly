import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { listActiveUserLeagueMemberships } from '@/lib/leagueMembership';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';

const REAL_DATA_CATEGORY_KEYS = new Set<FantasyCategoryKey>(REAL_DATA_NINE_CATEGORY_PRESET);

function normalizeCategories(value: unknown): FantasyCategoryKey[] {
  if (typeof value !== 'string') {
    return [...REAL_DATA_NINE_CATEGORY_PRESET];
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [...REAL_DATA_NINE_CATEGORY_PRESET];
    }

    const selected = parsed.filter(
      (entry): entry is FantasyCategoryKey =>
        typeof entry === 'string' && REAL_DATA_CATEGORY_KEYS.has(entry as FantasyCategoryKey)
    );

    return selected.length > 0 ? selected : [...REAL_DATA_NINE_CATEGORY_PRESET];
  } catch {
    return [...REAL_DATA_NINE_CATEGORY_PRESET];
  }
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

    const prismaMemberships = await prisma.leagueMember.findMany({
      where: { userId },
      include: {
        league: {
          include: {
            settings: true,
            drafts: { orderBy: { createdAt: 'desc' }, take: 1 },
            _count: { select: { members: true } },
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    if (prismaMemberships.length > 0) {
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
              : draft?.status === 'LIVE'
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
    }

    const memberships = await listActiveUserLeagueMemberships(userId);
    const leagueIds = memberships
      .map((membership) => membership.leagueId)
      .filter((leagueId) => leagueId.length > 0);

    // Fetch the actual league details for each membership
    const leagues = [];
    if (leagueIds.length > 0) {
      const leaguesRef = adminDb.collection('leagues');
      const leagueSnapshots = await Promise.all(leagueIds.map((id) => leaguesRef.doc(id).get()));

      for (const leagueDoc of leagueSnapshots) {
        if (leagueDoc.exists) {
          const data = leagueDoc.data();
          leagues.push({
            id: leagueDoc.id,
            ...data,
          });
        }
      }
    }

    logger.info(`Fetched ${memberships.length} league memberships for user ${userId}`);

    return NextResponse.json({
      success: true,
      leagues: leagues,
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
