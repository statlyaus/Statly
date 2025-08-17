import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import type { LeagueMember } from '@/types/leagues';
import { logger } from '@/lib/logger';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Get user's league memberships
    const membershipsRef = adminDb.collection('league_members');
    const snapshot = await membershipsRef.where('userId', '==', userId).get();

    const memberships: LeagueMember[] = [];
    const leagueIds: string[] = [];
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      const membership = {
        id: doc.id,
        leagueId: data.leagueId,
        userId: data.userId,
        role: data.role,
        teamName: data.teamName,
        joinedAt: data.joinedAt,
        isActive: data.isActive,
      };
      memberships.push(membership);
      leagueIds.push(data.leagueId);
    });

    // Fetch the actual league details for each membership
    const leagues = [];
    if (leagueIds.length > 0) {
      const leaguesRef = adminDb.collection('leagues');
      const leagueSnapshots = await Promise.all(
        leagueIds.map(id => leaguesRef.doc(id).get())
      );
      
      for (const leagueDoc of leagueSnapshots) {
        if (leagueDoc.exists) {
          const data = leagueDoc.data();
          leagues.push({
            id: leagueDoc.id,
            ...data,
          });
        }
      }
    }

    logger.info(`Fetched ${memberships.length} league memberships for user ${userId}`);

    return NextResponse.json(leagues);
  } catch (error) {
    logger.error('Error fetching user league memberships:', error);
    return NextResponse.json({ error: 'Failed to fetch user league memberships' }, { status: 500 });
  }
}
