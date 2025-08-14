import { type NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { calculateTotalValue } from '@/types/fantasyCategories';
import type { PlayerStats } from '@/types/fantasyCategories';

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
      
      // Transform Firebase data to expected format and calculate custom total value
      const playerData = {
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
        team: data.team,
        position: data.position || 'MID', // Default position since AFL data doesn't include this
        opposition: data.opposition,
      };

      // Calculate fantasy points using your custom algorithm
      const playerStats: PlayerStats = {
        games: 1, // Each record is per game
        kicks: data.stats?.kicks || data.raw_row?.kicks || 0,
        handballs: data.stats?.handballs || data.raw_row?.handballs || 0,
        marks: data.stats?.marks || data.raw_row?.marks || 0,
        tackles: data.stats?.tackles || data.raw_row?.tackles || 0,
        goals: data.stats?.goals || data.raw_row?.goals || 0,
        hitouts: data.stats?.hit_outs || data.raw_row?.hitouts || 0,
        clearances: data.stats?.clearances || data.raw_row?.clearances || 0,
        inside50s: data.stats?.inside_50s || data.raw_row?.inside_50s || 0,
        rebound50s: data.stats?.rebound_50s || data.raw_row?.rebound_50s || 0,
        clangers: data.stats?.clangers || data.raw_row?.clangers || 0,
        contestedPossessions: data.stats?.contested_possessions || data.raw_row?.contested_possessions || 0,
        uncontestedPossessions: data.stats?.uncontested_possessions || data.raw_row?.uncontested_possessions || 0,
        freesFor: data.stats?.frees_for || data.raw_row?.frees_for || 0,
        freesAgainst: data.stats?.frees_against || data.raw_row?.frees_against || 0,
        onePercenters: data.stats?.one_percenters || data.raw_row?.one_percenters || 0,
        goalAssists: data.stats?.goal_assists || data.raw_row?.goal_assists || 0,
        turnovers: data.stats?.turnovers || data.raw_row?.turnovers || 0,
        intercepts: data.stats?.intercepts || data.raw_row?.intercepts || 0,
        metresGained: data.stats?.metres_gained || data.raw_row?.metres_gained || 0,
        contestedMarks: data.stats?.contested_marks || data.raw_row?.contested_marks || 0,
        effectiveDisposals: data.stats?.effective_disposals || data.raw_row?.effective_disposals || 0,
        scoreInvolvements: data.stats?.score_involvements || data.raw_row?.score_involvements || 0,
        timeOnGroundPct: data.raw_row?.tog_pct || 80, // Default to 80% if missing
        disposalEffPct: data.raw_row?.disposal_efficiency || 75, // Default to 75% if missing
        seasonTotal: 0, // Not used in calculation
        avgFantasyPoints: 0, // Not used in calculation
        lastGameFantasyPoints: 0, // Not used in calculation
      };

      // Calculate the custom total value using your algorithm
      const customTotalValue = calculateTotalValue(playerStats);

      return {
        ...playerData,
        fantasy_points: customTotalValue,
        // Include all original data for debugging
        _original: data,
        _calculated_stats: playerStats
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
