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

export async function GET(request: NextRequest) {
  try {
    const db = getFirestore();
    const { searchParams } = new URL(request.url);
    const season = searchParams.get('season') || '2025';
    const round = searchParams.get('round');

    console.log(`[API] Querying player_match_stats for season=${season}, round=${round || 'all'}`);

    // Query player_match_stats collection
    let query = db.collection('player_match_stats').where('season', '==', parseInt(season));

    if (round) {
      query = query.where('round_number', '==', parseInt(round));
    }

    const snapshot = await query.limit(100).get();
    console.log(`[API] Firebase query returned ${snapshot.docs.length} documents`);

    const playerStats = snapshot.docs.map((doc) => {
      const data = doc.data();
      console.log(`[API] Document ${doc.id}:`, data);

      // Extract and calculate per-game averages for the 9 key categories
      // Each record is per game from AFL data

      // Your 9 defined categories (highest weighted in your algorithm)
      // These are the core stats that matter most for your custom scoring
      // Replaced missing categories with available high-value stats:
      // Clearances → Inside 50s, One Percenters → Effective Disposals, Goal Assists → Score Involvements
      const categories = {
        goals: data.goals || 0,
        tackles: data.tackles || 0,
        inside50s: data.inside_50s || 0, // Replaces clearances
        intercepts: data.intercepts || 0,
        contestedMarks: data.contested_marks || 0,
        rebound50s: data.rebound_50s || 0,
        contestedPossessions: data.contested_possessions || 0,
        effectiveDisposals: data.effective_disposals || 0, // Replaces one percenters
        scoreInvolvements: data.score_involvements || 0, // Replaces goal assists (not in raw data, using 0)
      };

      // Full stats object for total value calculation and profile log
      const playerStats: PlayerStats = {
        games: 1, // Each record is per game
        kicks: data.kicks || 0,
        handballs: data.handballs || 0,
        marks: data.marks || 0,
        tackles: categories.tackles,
        goals: categories.goals,
        hitouts: data.hitouts || 0,
        clearances: categories.inside50s, // Using inside 50s as clearances replacement
        inside50s: categories.inside50s,
        rebound50s: categories.rebound50s,
        clangers: data.clangers || 0,
        contestedPossessions: categories.contestedPossessions,
        uncontestedPossessions: data.uncontested_possessions || 0,
        freesFor: data.frees_for || 0,
        freesAgainst: data.frees_against || 0,
        onePercenters: categories.effectiveDisposals, // Using effective disposals as one percenters replacement
        goalAssists: categories.scoreInvolvements, // Using score involvements as goal assists replacement
        turnovers: data.turnovers || 0,
        intercepts: categories.intercepts,
        metresGained: data.metres_gained || 0,
        contestedMarks: categories.contestedMarks,
        effectiveDisposals: categories.effectiveDisposals,
        scoreInvolvements: categories.scoreInvolvements,
        timeOnGroundPct: data.tog_pct || 80, // Default 80% if missing
        disposalEffPct: data.disposal_efficiency || 75, // Default 75% if missing
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
          label: 'DE%',
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
      query: { season: parseInt(season), round: round ? parseInt(round) : null },
    });
  } catch (error) {
    console.error('[API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch player stats',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
