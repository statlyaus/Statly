import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import type { League, LeagueMember } from '@/types/leagues';

// GET /api/leagues/[id] - Get specific league details
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leagueId } = await params;

    // Get league data
    const leagueDoc = await adminDb.collection('leagues').doc(leagueId).get();
    
    if (!leagueDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'League not found' },
        { status: 404 }
      );
    }

    const league: League = {
      id: leagueDoc.id,
      ...leagueDoc.data()
    } as League;

    // Get league members
    const membersSnapshot = await adminDb.collection('league_members')
      .where('leagueId', '==', leagueId)
      .where('isActive', '==', true)
      .get();

    const members = membersSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as LeagueMember[];

    const response = {
      league: {
        ...league,
        members, // Add members to the league object
        currentTeams: members.length,
      },
      members,
      memberCount: members.length,
      spotsRemaining: league.maxTeams - members.length,
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error fetching league:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch league details' },
      { status: 500 }
    );
  }
}
