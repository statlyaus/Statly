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
        },
        {
          id: 'bot-member-1',
          leagueId: 'test-league-id',
          userId: 'bot-user-1',
          teamName: 'AFL Legends',
          joinedAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
          isActive: true,
          role: 'member'
        },
        {
          id: 'bot-member-2',
          leagueId: 'test-league-id',
          userId: 'bot-user-2',
          teamName: 'Footy Fanatics',
          joinedAt: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
          isActive: true,
          role: 'member'
        },
        {
          id: 'bot-member-3',
          leagueId: 'test-league-id',
          userId: 'bot-user-3',
          teamName: 'Goal Getters',
          joinedAt: new Date(Date.now() - 259200000).toISOString(), // 3 days ago
          isActive: true,
          role: 'member'
        },
        {
          id: 'bot-member-4',
          leagueId: 'test-league-id',
          userId: 'bot-user-4',
          teamName: 'Mark Masters',
          joinedAt: new Date(Date.now() - 345600000).toISOString(), // 4 days ago
          isActive: true,
          role: 'member'
        },
        {
          id: 'bot-member-5',
          leagueId: 'test-league-id',
          userId: 'bot-user-5',
          teamName: 'Tackle Titans',
          joinedAt: new Date(Date.now() - 432000000).toISOString(), // 5 days ago
          isActive: true,
          role: 'member'
        },
        {
          id: 'bot-member-6',
          leagueId: 'test-league-id',
          userId: 'bot-user-6',
          teamName: 'Disposal Dynamos',
          joinedAt: new Date(Date.now() - 518400000).toISOString(), // 6 days ago
          isActive: true,
          role: 'member'
        },
        {
          id: 'bot-member-7',
          leagueId: 'test-league-id',
          userId: 'bot-user-7',
          teamName: 'Inside 50 Kings',
          joinedAt: new Date(Date.now() - 604800000).toISOString(), // 7 days ago
          isActive: true,
          role: 'member'
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
