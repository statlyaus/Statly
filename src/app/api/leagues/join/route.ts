import { getUserIdFromRequest } from '@/lib/serverAuth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { commonErrors } from '@/lib/apiResponse';
import type { JoinLeagueRequest, League, LeagueMember } from '@/types/leagues';
import { listActiveLeagueMembers, queueLeagueMembershipSet } from '@/lib/leagueMembership';
import { syncPrismaLeagueMember } from '@/lib/prismaLeagueBridge';
import { isLeagueAtCapacity } from '@/server/leagues/leagueCapacity';
import {
  findPrismaLeagueIdByInviteCode,
  joinLeague,
  type JoinLeagueData,
} from '@/server/leagues/memberCommands';

type MembershipTransaction = Parameters<typeof queueLeagueMembershipSet>[0];

export const runtime = 'nodejs';

function normalizeInviteCode(code: string): string {
  return code.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

/**
 * Prisma owns membership, so a Prisma league is joined through the Prisma command and Firestore is
 * written afterwards as a compatibility projection. Returns `null` when the league has no Prisma row.
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
    const prismaLeagueId = await findPrismaLeagueIdByInviteCode(normalizedCode);
    const prismaJoin =
      prismaLeagueId && (await joinPrismaLeague(prismaLeagueId, userId, requestedTeamName));
    if (prismaJoin) {
      return prismaJoin;
    }

    // Legacy lookup: the Firestore code can differ from the Prisma one after an invite-code clash.
    console.log('🔍 Looking for league with code:', normalizedCode);

    const leagueSnapshot = await adminDb
      .collection('leagues')
      .where('code', '==', normalizedCode)
      .limit(1)
      .get();

    console.log('📊 League query result:', {
      empty: leagueSnapshot.empty,
      size: leagueSnapshot.size,
    });

    if (leagueSnapshot.empty) {
      console.log('❌ League not found for provided code');
      return NextResponse.json(
        {
          success: false,
          error: `League with code "${normalizedCode}" not found.`,
        },
        { status: 400 }
      );
    }

    const leagueDoc = leagueSnapshot.docs[0];
    const prismaLeagueJoin = await joinPrismaLeague(leagueDoc.id, userId, requestedTeamName);
    if (prismaLeagueJoin) {
      return prismaLeagueJoin;
    }

    // No Prisma row: a legacy league whose membership still lives only in Firestore.
    const league: League = {
      id: leagueDoc.id,
      ...leagueDoc.data(),
    } as League;

    // Check if league is joinable
    if (league.status !== 'preseason') {
      return NextResponse.json(
        { success: false, error: 'League is no longer accepting new members' },
        { status: 400 }
      );
    }

    const joinResult = await adminDb.runTransaction(async (tx) => {
      const leagueRef = adminDb.collection('leagues').doc(league.id);
      const freshLeagueDoc = await tx.get(leagueRef);
      if (!freshLeagueDoc.exists) {
        return { ok: false as const, status: 404, error: 'League not found' };
      }

      const freshLeague = { id: freshLeagueDoc.id, ...freshLeagueDoc.data() } as League;
      if (freshLeague.status !== 'preseason') {
        return {
          ok: false as const,
          status: 400,
          error: 'League is no longer accepting new members',
        };
      }

      const activeMembers = await listActiveLeagueMembers(freshLeague.id);
      if (
        isLeagueAtCapacity({
          activeMemberCount: activeMembers.length,
          maxTeams: freshLeague.maxTeams,
        })
      ) {
        return { ok: false as const, status: 400, error: 'League is full' };
      }

      const existingMember = activeMembers.find((member) => member.userId === userId);
      if (existingMember) {
        return { ok: false as const, status: 400, error: 'Already a member of this league' };
      }

      let finalTeamName = teamName?.trim();
      if (!finalTeamName) {
        finalTeamName = `${freshLeague.name} Team ${activeMembers.length + 1}`;
      }

      const duplicateName = activeMembers.find(
        (member) => member.teamName.trim().toLowerCase() === finalTeamName!.toLowerCase()
      );
      if (duplicateName) {
        return { ok: false as const, status: 400, error: 'Team name already taken' };
      }

      const newMember: Omit<LeagueMember, 'id'> = {
        leagueId: freshLeague.id,
        userId,
        role: 'member',
        teamName: finalTeamName,
        joinedAt: new Date().toISOString(),
        isActive: true,
      };

      const deterministicMemberId = queueLeagueMembershipSet(
        tx as unknown as MembershipTransaction,
        newMember
      );
      tx.set(
        leagueRef,
        {
          memberCount: activeMembers.length + 1,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      return {
        ok: true as const,
        draftSlot: activeMembers.length + 1,
        league: freshLeague,
        member: newMember,
        memberId: deterministicMemberId,
      };
    });

    if (!joinResult.ok) {
      return NextResponse.json(
        { success: false, error: joinResult.error },
        { status: joinResult.status }
      );
    }

    try {
      await syncPrismaLeagueMember({
        leagueId: joinResult.league.id,
        userId,
        memberId: joinResult.memberId,
        role: joinResult.member.role,
        teamName: joinResult.member.teamName,
        draftSlot: joinResult.draftSlot,
        isActive: true,
      });
    } catch (syncError) {
      console.warn('Failed to sync joined league member into Prisma mirror', {
        leagueId: joinResult.league.id,
        userId,
        error: syncError instanceof Error ? syncError.message : String(syncError),
      });
    }

    const createdMember: LeagueMember = {
      id: joinResult.memberId,
      ...joinResult.member,
    };

    return NextResponse.json(
      {
        success: true,
        data: {
          member: createdMember,
          league: {
            id: joinResult.league.id,
            name: joinResult.league.name,
            code: joinResult.league.code,
            type: joinResult.league.type,
            status: joinResult.league.status,
            draftDate: joinResult.league.draftDate,
          },
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error joining league:', error);
    return commonErrors.internalServerError('Failed to join league');
  }
}
