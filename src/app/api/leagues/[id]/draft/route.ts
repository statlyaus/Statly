import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { verifyLeagueMembership } from '@/lib/leagueMembership';
import { getLeagueDraftOperationalReadiness } from '@/server/draft/services/DraftReadinessService';

interface DraftPageProps {
  params: Promise<{ id: string }>;
}

async function authorizeLeagueDraftRead(request: NextRequest, leagueId: string) {
  const userId = await getAuthenticatedUserId(request);
  if (!userId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const membership = await verifyLeagueMembership(leagueId, userId);
  if (!membership.isMember) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  return null;
}

// GET /api/leagues/[id]/draft - Get or create draft for league
export async function GET(req: NextRequest, { params }: DraftPageProps): Promise<NextResponse> {
  try {
    const { id: leagueId } = await params;
    const authError = await authorizeLeagueDraftRead(req, leagueId);
    if (authError) {
      return authError;
    }

    const prismaLeague = await prisma.league.findUnique({
      where: { id: leagueId },
      include: { settings: true, drafts: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });

    if (prismaLeague) {
      const draft = prismaLeague.drafts[0] ?? null;
      const draftReadiness = await getLeagueDraftOperationalReadiness(prisma, { leagueId });

      return NextResponse.json({
        success: true,
        data: {
          hasDraft: Boolean(draft),
          draftId: draft?.id ?? null,
          status: draft?.status ?? null,
          startAt: prismaLeague.settings.startAt.toISOString(),
          createdAt: draft?.createdAt.toISOString() ?? null,
          league: { id: prismaLeague.id, name: prismaLeague.name },
          draftReadiness,
          message: draft
            ? 'Draft found for this league.'
            : 'No draft found for this league. Save draft settings to prepare the draft room.',
        },
      });
    }

    // Development shortcut: support test league without requiring Firestore
    if (leagueId === 'test-league-id') {
      return NextResponse.json({
        success: true,
        data: {
          hasDraft: false,
          draftId: null,
          league: { id: 'test-league-id', name: 'Test AFL Champions League' },
          message: 'Test league: no draft exists yet',
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
        hasDraft: false,
        draftId: null,
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
