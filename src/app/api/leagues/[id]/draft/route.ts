import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { getLeagueMembershipAccess } from '@/server/leagues/membership';
import { getLeagueDraftOperationalReadiness } from '@/server/draft/services/DraftReadinessService';

interface DraftPageProps {
  params: Promise<{ id: string }>;
}

// GET /api/leagues/[id]/draft - Read the league's latest Prisma draft.
// Prisma is the only league and draft authority: a league with no Prisma row is legacy data and is
// not found. Firestore league documents are never read here.
export async function GET(req: NextRequest, { params }: DraftPageProps): Promise<NextResponse> {
  try {
    const { id: leagueId } = await params;
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const prismaLeague = await prisma.league.findUnique({
      where: { id: leagueId },
      include: {
        settings: true,
        drafts: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { members: { where: { isActive: true } } } },
      },
    });
    if (!prismaLeague) {
      return NextResponse.json({ success: false, error: 'League not found' }, { status: 404 });
    }

    const access = await getLeagueMembershipAccess(leagueId, userId);
    if (!access.isMember) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

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
  } catch (error) {
    console.error('Error fetching league draft:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch league draft' },
      { status: 500 }
    );
  }
}
