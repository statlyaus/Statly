import { getUserIdFromRequest } from '@/lib/serverAuth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { commonErrors } from '@/lib/apiResponse';
import type { JoinLeagueRequest } from '@/types/leagues';
import { queueLeagueMembershipSet } from '@/lib/leagueMembership';
import {
  findPrismaLeagueIdByInviteCode,
  joinLeague,
  type JoinLeagueData,
} from '@/server/leagues/memberCommands';

export const runtime = 'nodejs';

function normalizeInviteCode(code: string): string {
  return code.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

/**
 * Prisma owns membership, so a Prisma league is joined through the Prisma command and Firestore is
 * written afterwards as a compatibility projection. Returns `null` when the league has no Prisma row,
 * which the caller reports as not found.
 */
async function joinPrismaLeague(
  leagueId: string,
  userId: string,
  teamName: string | undefined
): Promise<NextResponse | null> {
  const result = await joinLeague({ leagueId, userId, teamName });
  if (!result.ok) {
    if (result.code === 'league-not-found') return null;
    return NextResponse.json(
      { success: false, error: result.message, code: result.code },
      { status: 400 }
    );
  }

  await projectJoinToFirestoreBestEffort(result.data);

  return NextResponse.json(
    {
      success: true,
      data: {
        member: result.data.member,
        league: {
          id: result.data.league.id,
          name: result.data.league.name,
          code: result.data.league.inviteCode,
          draftDate: result.data.league.draftDate,
        },
      },
    },
    { status: 201 }
  );
}

/** A failed projection is logged for repair; the committed Prisma join still succeeded. */
async function projectJoinToFirestoreBestEffort(data: JoinLeagueData) {
  try {
    const batch = adminDb.batch();
    queueLeagueMembershipSet(batch, data.member, { topLevelMemberId: data.member.id });
    batch.update(adminDb.collection('leagues').doc(data.league.id), {
      memberCount: data.memberCount,
      updatedAt: new Date().toISOString(),
    });
    await batch.commit();
  } catch (projectionError) {
    console.warn('Failed to project league join to Firestore', {
      leagueId: data.league.id,
      userId: data.member.userId,
      error: projectionError instanceof Error ? projectionError.message : String(projectionError),
    });
  }
}

// POST /api/leagues/join - Join league by code
export async function POST(req: NextRequest) {
  const userId = await getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = (await req.json()) as JoinLeagueRequest;

    const { code, teamName } = body;

    if (!code || typeof code !== 'string') {
      return NextResponse.json(
        { success: false, error: 'League code is required' },
        { status: 400 }
      );
    }
    const normalizedCode = normalizeInviteCode(code);

    if (!normalizedCode) {
      return NextResponse.json(
        { success: false, error: 'League code is required' },
        { status: 400 }
      );
    }

    const requestedTeamName = typeof teamName === 'string' ? teamName : undefined;
    // Prisma owns membership: a code with no Prisma league is not found, never decided from Firestore.
    const prismaLeagueId = await findPrismaLeagueIdByInviteCode(normalizedCode);
    const prismaJoin =
      prismaLeagueId && (await joinPrismaLeague(prismaLeagueId, userId, requestedTeamName));
    if (prismaJoin) {
      return prismaJoin;
    }

    return NextResponse.json(
      {
        success: false,
        error: `League with code "${normalizedCode}" not found.`,
      },
      { status: 400 }
    );
  } catch (error) {
    console.error('Error joining league:', error);
    return commonErrors.internalServerError('Failed to join league');
  }
}
