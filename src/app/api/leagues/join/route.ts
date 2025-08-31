import { getUserIdFromRequest } from '@/lib/serverAuth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { commonErrors } from '@/lib/apiResponse';
import type {
  JoinLeagueRequest,
  League,
  LeagueMember,
  JoinedLeagueSummary,
} from '@/types/leagues';
import { generateDeterministicMemberId } from '@/utils/firestore';

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
      const testLeague: JoinedLeagueSummary = {
        id: 'test-league-id',
        name: 'Test AFL Champions League',
        code: '123ABC',
        type: 'public',
        status: 'preseason',
        draftDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      };

      // Check if user is already a member (simulate check)
      console.log('✅ Test league found, proceeding with join...');
      
      // Add member to league (simulate) with deterministic id matching production strategy
      const deterministicMemberId = generateDeterministicMemberId(testLeague.id, userId);
      const newMember: LeagueMember = {
        id: deterministicMemberId,
        leagueId: testLeague.id,
        userId,
        role: 'member',
        teamName,
        joinedAt: new Date().toISOString(),
        isActive: true
      };

      console.log('🎉 Successfully joined test league!');
      return NextResponse.json({
        success: true,
        message: `Successfully joined ${testLeague.name}`,
        data: {
          league: testLeague,
          member: newMember
        }
      });
    }

    const leagueSnapshot = await adminDb
      .collection('leagues')
      .where('code', '==', code.toUpperCase())
      .limit(1)
      .get();

    console.log('📊 League query result:', { 
      empty: leagueSnapshot.empty, 
      size: leagueSnapshot.size 
    });

    if (leagueSnapshot.empty) {
      // Let's also check what leagues exist for debugging
      const allLeaguesSnapshot = await adminDb.collection('leagues').limit(5).get();
      const existingLeagues = allLeaguesSnapshot.docs.map(doc => ({
        id: doc.id,
        code: doc.data().code,
        name: doc.data().name
      }));
      
      console.log('❌ League not found. Existing leagues:', existingLeagues);
      return NextResponse.json(
        { 
          success: false, 
          error: `League with code "${code.toUpperCase()}" not found. Try the test code "123ABC" to test the join functionality!`,
          debug: { availableLeagues: existingLeagues }
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

    // Check if league is full
    const membersSnapshot = await adminDb
      .collection('leagueMembers')
      .where('leagueId', '==', league.id)
      .where('isActive', '==', true)
      .get();

    if (membersSnapshot.size >= league.maxTeams) {
      return NextResponse.json({ success: false, error: 'League is full' }, { status: 400 });
    }

    // Check if user is already a member
    const existingMember = membersSnapshot.docs.find((doc) => doc.data().userId === userId);

    if (existingMember) {
      return NextResponse.json(
        { success: false, error: 'Already a member of this league' },
        { status: 400 }
      );
    }

    // Validate team name
    let finalTeamName = teamName?.trim();
    if (!finalTeamName) {
      finalTeamName = `${league.name} Team ${membersSnapshot.size + 1}`;
    }

    // Check for duplicate team names
    const duplicateName = membersSnapshot.docs.find(
      (doc) => doc.data().teamName.toLowerCase() === finalTeamName!.toLowerCase()
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

    const deterministicMemberId = generateDeterministicMemberId(league.id, userId);
    await adminDb.collection('leagueMembers').doc(deterministicMemberId).set(newMember, { merge: true });

    const createdMember: LeagueMember = {
      id: deterministicMemberId,
      ...newMember,
    };

    const leagueSummary: JoinedLeagueSummary = {
      id: league.id,
      name: league.name,
      code: league.code,
      type: league.type,
      status: league.status,
      draftDate: league.draftDate,
    };

    return NextResponse.json(
      {
        success: true,
        data: {
          member: createdMember,
          league: leagueSummary,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error joining league:', error);
    return commonErrors.internalServerError('Failed to join league');
  }
}
