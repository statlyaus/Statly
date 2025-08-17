import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { commonErrors } from '@/lib/apiResponse';
import type { JoinLeagueRequest, League, LeagueMember } from '@/types/leagues';

// POST /api/leagues/join - Join league by code
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as JoinLeagueRequest;
    const userId = req.headers.get('x-user-id');

    if (!userId) {
      return commonErrors.unauthorized('Must be logged in to join a league');
    }

    const { code, teamName } = body;

    if (!code || typeof code !== 'string') {
      return NextResponse.json(
        { success: false, error: 'League code is required' },
        { status: 400 }
      );
    }

        // Find league by code
    console.log('🔍 Looking for league with code:', code.toUpperCase());
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
          error: `League with code "${code.toUpperCase()}" not found`,
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

    const memberRef = await adminDb.collection('leagueMembers').add(newMember);

    const createdMember: LeagueMember = {
      id: memberRef.id,
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
