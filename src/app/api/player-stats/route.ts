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
      const decodedJson = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64, 'base64').toString('utf-8');
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

export async function GET(request: NextRequest) {
  try {
    const db = getFirestore();
    const { searchParams } = new URL(request.url);
    const season = searchParams.get('season') || '2025';
    const round = searchParams.get('round');

    console.log(`[API] Querying player_match_stats for season=${season}, round=${round || 'all'}`);

    // Query player_match_stats collection
    let query = db.collection('player_match_stats')
      .where('season', '==', parseInt(season));
    
    if (round) {
      query = query.where('round_number', '==', parseInt(round));
    }

    const snapshot = await query.limit(100).get();
    console.log(`[API] Firebase query returned ${snapshot.docs.length} documents`);

    const playerStats = snapshot.docs.map(doc => {
      const data = doc.data();
      console.log(`[API] Document ${doc.id}:`, data);
      
      // Transform Firebase data to expected format
      return {
        id: data.player_uid || doc.id,
        player_id: data.player_uid || doc.id,
        player_name: data.player_name,
        match_id: data.match_uid,
        season: data.season,
        round_number: data.round,
        disposals: data.stats?.disposals || data.raw_row?.disposals || 0,
        goals: data.stats?.goals || data.raw_row?.goals || 0,
        behinds: data.stats?.behinds || data.raw_row?.behinds || 0,
        marks: data.stats?.marks || data.raw_row?.marks || 0,
        tackles: data.stats?.tackles || data.raw_row?.tackles || 0,
        fantasy_points: data.raw_row?.supercoach_score || data.raw_row?.player_value || 50, // Use supercoach score as fantasy points
        team: data.team,
        position: data.position || 'MID', // Default position since AFL data doesn't include this
        opposition: data.opposition,
        // Include all original data for debugging
        _original: data
      };
    });

    console.log(`[API] Returning ${playerStats.length} player stats`);

    return NextResponse.json({
      success: true,
      data: playerStats,
      count: playerStats.length,
      timestamp: new Date().toISOString(),
      query: { season: parseInt(season), round: round ? parseInt(round) : null }
    });

  } catch (error) {
    console.error('[API] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch player stats', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
