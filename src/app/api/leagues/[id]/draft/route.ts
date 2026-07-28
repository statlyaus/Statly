import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import {
  getLeagueMembershipAccess,
  type LeagueMembershipAccess,
} from '@/server/leagues/membership';
import { getLeagueDraftOperationalReadiness } from '@/server/draft/services/DraftReadinessService';

interface DraftPageProps {
  params: Promise<{ id: string }>;
}

interface DraftReadAuthorization {
  access: LeagueMembershipAccess;
}

async function authorizeLeagueDraftRead(
  request: NextRequest,
  leagueId: string
): Promise<DraftReadAuthorization | NextResponse> {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const access = await getLeagueMembershipAccess(leagueId, userId);
  if (!access.isMember) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  return { access };
}

// GET /api/leagues/[id]/draft - Get or create draft for league
export async function GET(req: NextRequest, { params }: DraftPageProps): Promise<NextResponse> {
  try {
    const { id: leagueId } = await params;
    const authorization = await authorizeLeagueDraftRead(req, leagueId);
    if (authorization instanceof NextResponse) {
      return authorization;
    }
    const { access } = authorization;

    const prismaLeague = await prisma.league.findUnique({
      where: { id: leagueId },
      include: {
        settings: true,
        drafts: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { members: true } },
      },
    });

    if (prismaLeague) {
      const draft = prismaLeague.drafts[0] ?? null;
      const settings = prismaLeague.settings;
      const draftReadiness = await getLeagueDraftOperationalReadiness(prisma, { leagueId });

      return NextResponse.json({
        success: true,
        data: {
          leagueId,
          draft: draft
            ? {
                id: draft.id,
                status: draft.status,
                type: settings.draftType,
                pickSeconds: settings.pickSeconds,
                startAt: settings.startAt?.toISOString() ?? null,
                currentPick: draft.currentPick,
                totalPicks: draft.totalPicks,
                createdAt: draft.createdAt.toISOString(),
              }
            : null,
          canManage: access.canManage,
          memberCount: prismaLeague._count.members,
          maxTeams: settings.maxTeams,
          league: { id: prismaLeague.id, name: prismaLeague.name },
          draftReadiness,
          message: draft
            ? 'Draft found for this league.'
            : 'No draft found for this league. Save draft settings to prepare the draft room.',
        },
      });
    }

    // Check league exists
    const leagueRef = adminDb.collection('leagues').doc(leagueId);
    const leagueSnap = await leagueRef.get();
    if (!leagueSnap.exists) {
      return NextResponse.json({ success: false, error: 'League not found' }, { status: 404 });
    }
    const league = { id: leagueSnap.id, ...leagueSnap.data() } as Record<string, unknown>;

    return NextResponse.json({
      success: true,
      data: {
        leagueId,
        draft: null,
        canManage: access.canManage,
        memberCount: 0,
        maxTeams:
          typeof league.maxTeams === 'number'
            ? league.maxTeams
            : typeof league.maxTeams === 'string'
              ? Number.parseInt(league.maxTeams, 10)
              : 0,
        league,
        message:
          'No Prisma draft found for this league. Create drafts through POST /api/drafts so Prisma remains the draft authority.',
      },
    });
  } catch (error) {
    console.error('Error fetching league draft:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch league draft' },
      { status: 500 }
    );
  }
}

// POST /api/leagues/[id]/draft - Create draft for league
export async function POST(_req: NextRequest, { params }: DraftPageProps): Promise<NextResponse> {
  const { id: leagueId } = await params;

  return NextResponse.json(
    {
      success: false,
      error:
        'Legacy Firestore draft creation is disabled. Create drafts through POST /api/drafts so Prisma remains the draft authority.',
      data: {
        leagueId,
        canonicalEndpoint: '/api/drafts',
      },
    },
    { status: 409 }
  );
}
