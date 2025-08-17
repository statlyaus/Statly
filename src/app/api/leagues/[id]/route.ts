import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import type { League, LeagueMember } from '@/types/leagues';

// GET /api/leagues/[id] - Get specific league details
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: leagueId } = await params;

    // Handle test league for development
    if (leagueId === 'test-league-id') {
      const testLeague: League = {
        id: 'test-league-id',
        name: 'Test AFL Champions League',
        description: 'Test league for development and demonstration',
        type: 'public',
        code: '123ABC',
        maxTeams: 12,
        currentTeams: 8,
        ownerId: '2qlfdHSCFTPlxoKFSUfNLSlCDRe2',
        categories: ['goals', 'kicks', 'handballs', 'marks', 'tackles', 'inside50s'],
        status: 'active',
        createdAt: new Date().toISOString(),
        tradeSettings: {
          tradeLimit: 10,
          tradeReview: 'none'
        },
        waiverWire: {
          waiverOrder: [],
          waiverPeriodHours: 24,
          waiverResetPolicy: 'weekly'
        }
      };

      const testMembers: LeagueMember[] = [
        {
          id: 'test-member-1',
          leagueId: 'test-league-id',
          userId: '2qlfdHSCFTPlxoKFSUfNLSlCDRe2',
          teamName: 'Robbo Rockers',
          joinedAt: new Date().toISOString(),
          isActive: true,
          role: 'owner'
        }
      ];

      const response = {
        league: testLeague,
        members: testMembers,
        memberCount: testMembers.length,
        spotsRemaining: testLeague.maxTeams - testMembers.length,
      };

      return NextResponse.json({ success: true, data: response });
    }

    // Get league data
    const leagueDoc = await adminDb.collection('leagues').doc(leagueId).get();

    if (!leagueDoc.exists) {
      return NextResponse.json({ success: false, error: 'League not found' }, { status: 404 });
    }

    const league: League = {
      id: leagueDoc.id,
      ...leagueDoc.data(),
    } as League;

    // Get league members
    const membersSnapshot = await adminDb
      .collection('leagueMembers')
      .where('leagueId', '==', leagueId)
      .where('isActive', '==', true)
      .get();

    const members = membersSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as LeagueMember[];

    const response = {
      league,
      members,
      memberCount: members.length,
      spotsRemaining: league.maxTeams - members.length,
    };

    return NextResponse.json({ success: true, data: response });
  } catch (error) {
    console.error('Error fetching league:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch league details' },
      { status: 500 }
    );
  }
}
