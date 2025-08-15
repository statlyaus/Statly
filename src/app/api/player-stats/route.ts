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
      
      // Extract and calculate per-game averages for the 9 key categories
      // Each record is per game from AFL data
      
      // Your 9 defined categories (highest weighted in your algorithm)
      // These are the core stats that matter most for your custom scoring
      const categories = {
        goals: data.stats?.goals || data.raw_row?.goals || 0,
        tackles: data.stats?.tackles || data.raw_row?.tackles || 0,
        clearances: data.stats?.clearances || data.raw_row?.clearances || 0,
        intercepts: data.stats?.intercepts || data.raw_row?.intercepts || 0,
        contestedMarks: data.stats?.contested_marks || data.raw_row?.contested_marks || 0,
        rebound50s: data.stats?.rebound_50s || data.raw_row?.rebound_50s || 0,
        contestedPossessions: data.stats?.contested_possessions || data.raw_row?.contested_possessions || 0,
        onePercenters: data.stats?.one_percenters || data.raw_row?.one_percenters || 0,
        goalAssists: data.stats?.goal_assists || data.raw_row?.goal_assists || 0,
      };

      // Full stats object for total value calculation and profile log
      const playerStats: PlayerStats = {
        games: 1, // Each record is per game
        kicks: data.stats?.kicks || data.raw_row?.kicks || 0,
        handballs: data.stats?.handballs || data.raw_row?.handballs || 0,
        marks: data.stats?.marks || data.raw_row?.marks || 0,
        tackles: categories.tackles,
        goals: categories.goals,
        hitouts: data.stats?.hit_outs || data.raw_row?.hitouts || 0,
        clearances: categories.clearances,
        inside50s: data.stats?.inside_50s || data.raw_row?.inside_50s || 0,
        rebound50s: categories.rebound50s,
        clangers: data.stats?.clangers || data.raw_row?.clangers || 0,
        contestedPossessions: categories.contestedPossessions,
        uncontestedPossessions: data.stats?.uncontested_possessions || data.raw_row?.uncontested_possessions || 0,
        freesFor: data.stats?.frees_for || data.raw_row?.frees_for || 0,
        freesAgainst: data.stats?.frees_against || data.raw_row?.frees_against || 0,
        onePercenters: categories.onePercenters,
        goalAssists: categories.goalAssists,
        turnovers: data.stats?.turnovers || data.raw_row?.turnovers || 0,
        intercepts: categories.intercepts,
        metresGained: data.stats?.metres_gained || data.raw_row?.metres_gained || 0,
        contestedMarks: categories.contestedMarks,
        effectiveDisposals: data.stats?.effective_disposals || data.raw_row?.effective_disposals || 0,
        scoreInvolvements: data.stats?.score_involvements || data.raw_row?.score_involvements || 0,
        timeOnGroundPct: data.raw_row?.tog_pct || 80,
        disposalEffPct: data.raw_row?.disposal_efficiency || 75,
        seasonTotal: 0,
        avgFantasyPoints: 0,
        lastGameFantasyPoints: 0,
      };

      // Calculate the custom total value using your algorithm
      const totalValue = calculateTotalValue(playerStats);

      return {
        id: data.player_uid || doc.id,
        player_id: data.player_uid || doc.id,
        player_name: data.player_name,
        team: data.team,
        position: data.position || 'MID',
        
        // 9 defined categories (per-game values from AFL data)
        categories,
        
        // Total value from your weighted algorithm
        totalValue,
        
        // 10th cell - efficiency metric as additional insight
        tenthCell: {
          type: 'efficiency',
          value: Math.round(playerStats.disposalEffPct),
          label: 'DE%'
        },
        
        // Complete per-game log for detailed profile view
        perGameLog: playerStats,
        
        // Match context information
        match_id: data.match_uid,
        season: data.season,
        round_number: data.round,
        opposition: data.opposition,
        
        // For component compatibility
        fantasy_points: totalValue,
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
