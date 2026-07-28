import { getUserIdFromRequest } from '@/lib/serverAuth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { commonErrors } from '@/lib/apiResponse';
import type { JoinLeagueRequest, League, LeagueMember } from '@/types/leagues';
import { listActiveLeagueMembers, queueLeagueMembershipSet } from '@/lib/leagueMembership';
import { syncPrismaLeagueMember } from '@/lib/prismaLeagueBridge';
import { isLeagueAtCapacity } from '@/server/leagues/leagueCapacity';

type MembershipTransaction = Parameters<typeof queueLeagueMembershipSet>[0];

export const runtime = 'nodejs';

function normalizeInviteCode(code: string): string {
  return code.replace(/[^a-z0-9]/gi, '').toUpperCase();
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

    // Find league by code
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
