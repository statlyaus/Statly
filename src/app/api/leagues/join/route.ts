import { getUserIdFromRequest } from '@/lib/serverAuth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { commonErrors } from '@/lib/apiResponse';
import type { JoinLeagueRequest, League, LeagueMember } from '@/types/leagues';
import {
  getLeagueMemberDocId,
  listActiveLeagueMembers,
  queueLeagueMembershipSet,
} from '@/lib/leagueMembership';
import { syncPrismaLeagueMember } from '@/lib/prismaLeagueBridge';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

export const runtime = 'nodejs';

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

    // Find league by code
    console.log('🔍 Looking for league with code:', code.toUpperCase());

    // For testing purposes, accept "123ABC" as a test code
    if (code.toUpperCase() === '123ABC') {
      console.log('🧪 Using test mode for code 123ABC');

      // Create a mock league for testing
      const testLeague = {
        id: 'test-league-id',
        name: 'Test AFL Champions League',
        code: '123ABC',
        type: 'public',
        ownerId: 'test-owner',
        maxTeams: 12,
        status: 'preseason',
        categories: [...REAL_DATA_NINE_CATEGORY_PRESET],
        createdAt: new Date().toISOString(),
        draftDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      };

      // Check if user is already a member (simulate check)
      console.log('✅ Test league found, proceeding with join...');

      // Add member to league (simulate) with deterministic id matching production strategy
      const deterministicMemberId = getLeagueMemberDocId(testLeague.id, userId);
      const newMember: LeagueMember = {
        id: deterministicMemberId,
        leagueId: testLeague.id,
        userId,
        role: 'member',
        teamName,
        joinedAt: new Date().toISOString(),
        isActive: true,
      };

      console.log('🎉 Successfully joined test league!');
      return NextResponse.json({
        success: true,
        message: `Successfully joined ${testLeague.name}`,
        data: {
          league: testLeague,
          member: newMember,
        },
      });
    }

    const leagueSnapshot = await adminDb
      .collection('leagues')
      .where('code', '==', code.toUpperCase())
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
          error: `League with code "${code.toUpperCase()}" not found.`,
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

    const activeMembers = await listActiveLeagueMembers(league.id);

    if (activeMembers.length >= league.maxTeams) {
      return NextResponse.json({ success: false, error: 'League is full' }, { status: 400 });
    }

    // Check if user is already a member
    const existingMember = activeMembers.find((member) => member.userId === userId);

    if (existingMember) {
      return NextResponse.json(
        { success: false, error: 'Already a member of this league' },
        { status: 400 }
      );
    }

    // Validate team name
    let finalTeamName = teamName?.trim();
    if (!finalTeamName) {
      finalTeamName = `${league.name} Team ${activeMembers.length + 1}`;
    }

    // Check for duplicate team names
    const duplicateName = activeMembers.find(
      (member) => member.teamName.trim().toLowerCase() === finalTeamName!.toLowerCase()
    );

    if (duplicateName) {
      return NextResponse.json(
        { success: false, error: 'Team name already taken' },
        { status: 400 }
      );
    }

    // Create league member
    const newMember: Omit<LeagueMember, 'id'> = {
      leagueId: league.id,
      userId,
      role: 'member',
      teamName: finalTeamName,
      joinedAt: new Date().toISOString(),
      isActive: true,
    };

    const batch = adminDb.batch();
    const deterministicMemberId = queueLeagueMembershipSet(batch, newMember);
    await batch.commit();

    try {
      await syncPrismaLeagueMember({
        leagueId: league.id,
        userId,
        memberId: deterministicMemberId,
        role: newMember.role,
        teamName: newMember.teamName,
        draftSlot: activeMembers.length + 1,
        isActive: true,
      });
    } catch (syncError) {
      console.warn('Failed to sync joined league member into Prisma mirror', {
        leagueId: league.id,
        userId,
        error: syncError instanceof Error ? syncError.message : String(syncError),
      });
    }

    const createdMember: LeagueMember = {
      id: deterministicMemberId,
      ...newMember,
    };

    return NextResponse.json(
      {
        success: true,
        data: {
          member: createdMember,
          league: {
            id: league.id,
            name: league.name,
            code: league.code,
            type: league.type,
            status: league.status,
            draftDate: league.draftDate,
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
