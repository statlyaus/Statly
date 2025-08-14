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
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    // Get user's league memberships
    const membershipsRef = adminDb.collection('league_members');
    const snapshot = await membershipsRef.where('userId', '==', userId).get();

    const memberships: LeagueMember[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      memberships.push({
        id: doc.id,
        leagueId: data.leagueId,
        userId: data.userId,
        role: data.role,
        teamName: data.teamName,
        joinedAt: data.joinedAt,
        isActive: data.isActive
      });
    });

    logger.info(`Fetched ${memberships.length} league memberships for user ${userId}`);

    return NextResponse.json({
      memberships,
      total: memberships.length
    });

  } catch (error) {
    logger.error('Error fetching user league memberships:', error);
    return NextResponse.json(
      { error: 'Failed to fetch user league memberships' },
      { status: 500 }
    );
  }
}
