import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

export interface LivePlayerStats {
  player_uid: string;
  stats: Record<string, number | null>;
  last_seen_at: string;
}

/**
 * GET /api/live-player-stats?matchUid={matchUid}
 * Returns live player statistics for a specific match
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const matchUid = searchParams.get('matchUid');
    
    if (!matchUid) {
      return NextResponse.json(
        { error: 'matchUid parameter is required' },
        { status: 400 }
      );
    }
    
    console.log(`🔍 Fetching live player stats for match: ${matchUid}`);
    
    // Query Firestore for player stats for this match
    const snapshot = await adminDb.collection('player_match_stats')
      .where('match_uid', '==', matchUid)
      .orderBy('last_updated', 'desc')
      .get();
    
    console.log(`📊 Found ${snapshot.size} player records for match ${matchUid}`);
    
    if (snapshot.empty) {
      return NextResponse.json({
        matchUid,
        players: [],
        count: 0,
        message: 'No player stats found for this match'
      });
    }
    
    // Transform documents to response format
    const players: LivePlayerStats[] = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        player_uid: data.player_uid,
        stats: data.stats || {},
        last_seen_at: data.last_updated?.toDate?.()?.toISOString() || new Date().toISOString()
      };
    });
    
    return NextResponse.json({
      matchUid,
      players,
      count: players.length,
      lastUpdated: new Date().toISOString(),
      source: 'footywire_fitzroy'
    });
    
  } catch (error) {
    console.error('Error fetching live player stats:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch live player stats',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
