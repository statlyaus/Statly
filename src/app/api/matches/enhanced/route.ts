import { type NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin (server-side only)
if (!getApps().length) {
  try {
    let serviceAccount;

    // Try to get service account from different environment variables
    if (process.env.GOOGLE_SERVICE_ACCOUNT) {
      serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64) {
      const decodedJson = Buffer.from(
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64,
        'base64'
      ).toString('utf-8');
      serviceAccount = JSON.parse(decodedJson);
    } else {
      throw new Error('No Firebase service account found in environment variables');
    }

    initializeApp({
      credential: cert(serviceAccount),
    });
  } catch (error) {
    console.error('Failed to initialize Firebase Admin:', error);
  }
}

export async function GET(_request: NextRequest) {
  try {
    const db = getFirestore();
    const { searchParams } = new URL(request.url);
    const season = searchParams.get('season') || '2025';
    const round = searchParams.get('round');

    // Query matches collection
    let matchQuery = db.collection('matches').where('season', '==', parseInt(season));

    if (round) {
      matchQuery = matchQuery.where('round_number', '==', parseInt(round));
    }

    const matchSnapshot = await matchQuery.limit(50).get();
    const matches = matchSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Enhance matches with player stats if needed
    const enhancedMatches = await Promise.all(
      matches.map(async (match) => {
        try {
          // Get player stats for this match
          const playerStatsQuery = db
            .collection('player_match_stats')
            .where('match_id', '==', match.id);

          const statsSnapshot = await playerStatsQuery.get();
          const playerStats = statsSnapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }));

          return {
            ...match,
            player_stats: playerStats,
            player_count: playerStats.length,
          };
        } catch (error) {
          console.warn(`Failed to fetch stats for match ${match.id}:`, error);
          return {
            ...match,
            player_stats: [],
            player_count: 0,
          };
        }
      })
    );

    return NextResponse.json({
      success: true,
      data: enhancedMatches,
      count: enhancedMatches.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Enhanced Matches API Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch enhanced matches',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
