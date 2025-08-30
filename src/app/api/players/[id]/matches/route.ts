export const runtime = 'nodejs';

import { type NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { commonErrors, successResponse } from '@/lib/apiResponse';
import { calculateTotalValue, type PlayerStats } from '@/types/fantasyCategories';

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    
    console.log(`🔍 Fetching matches for player: ${id}`);
    
    // Query player match stats for the specific player
    const snapshot = await adminDb
      .collection('player_match_stats')
      .where('player_name', '==', decodeURIComponent(id))
      .orderBy('round', 'desc')
      .get();

    console.log(`📊 Found ${snapshot.size} match records for ${id}`);

    if (snapshot.empty) {
      return successResponse([]);
    }

    const matches = snapshot.docs.map((doc) => {
      const data = doc.data();
      console.log(`📋 Processing match: Round ${data.round} vs ${data.opposition}`);
      
      // Create PlayerStats object for custom scoring calculation
      const playerStats: PlayerStats = {
        games: 1, // This is a single match
        kicks: data.kicks || 0,
        handballs: data.handballs || 0,
        marks: data.marks || 0,
        tackles: data.tackles || 0,
        goals: data.goals || 0,
        hitouts: data.hitouts || 0,
        clearances: data.clearances || 0,
        inside50s: data.inside_50s || 0,
        rebound50s: data.rebound_50s || 0,
        clangers: data.clangers || 0,
        contestedPossessions: data.contested_possessions || 0,
        uncontestedPossessions: data.uncontested_possessions || 0,
        freesFor: data.frees_for || 0,
        freesAgainst: data.frees_against || 0,
        onePercenters: data.one_percenters || 0,
        goalAssists: data.goal_assists || 0,
        timeOnGroundPct: data.time_on_ground_percentage || 85, // Default if missing
        disposalEffPct: data.disposal_efficiency || 75, // Default if missing
        turnovers: data.turnovers || 0,
        intercepts: data.intercepts || 0,
        metresGained: data.metres_gained || 0,
        contestedMarks: data.contested_marks || 0,
        effectiveDisposals: data.effective_disposals || 0,
        scoreInvolvements: data.score_involvements || 0,
      };
      
      // Calculate custom fantasy score using your algorithm
      const customFantasyScore = calculateTotalValue(playerStats);
      
      return {
        round: data.round || 0,
        opposition: data.opposition || 'Unknown',
        opponent: data.opposition || 'Unknown', // Frontend expects both fields
        fantasyScore: customFantasyScore, // Using custom scoring instead of SuperCoach
        totalValue: customFantasyScore, // Use same value for consistency
        stats: {
          disposals: data.disposals || 0,
          kicks: data.kicks || 0,
          handballs: data.handballs || 0,
          marks: data.marks || 0,
          goals: data.goals || 0,
          behinds: data.behinds || 0,
          tackles: data.tackles || 0,
          hitouts: data.hitouts || 0,
          inside_50s: data.inside_50s || 0,
          rebound_50s: data.rebound_50s || 0,
          clangers: data.clangers || 0,
          contested_possessions: data.contested_possessions || 0,
          uncontested_possessions: data.uncontested_possessions || 0,
          effective_disposals: data.effective_disposals || 0,
          disposal_efficiency: data.disposal_efficiency || 0,
          contested_marks: data.contested_marks || 0,
          intercepts: data.intercepts || 0,
          clearances: data.clearances || 0,
          metres_gained: data.metres_gained || 0,
          score_involvements: data.score_involvements || 0,
          goal_assists: data.goal_assists || 0,
          frees_for: data.frees_for || 0,
          frees_against: data.frees_against || 0,
          one_percenters: data.one_percenters || 0,
          turnovers: data.turnovers || 0,
          time_on_ground_percentage: data.time_on_ground_percentage || 0,
        },
        season: data.season || 2025,
        matchDate: data.date || null,
        venue: data.venue || null,
        team: data.team || 'Unknown', // Player's team
      };
    });

    console.log(`✅ Returning ${matches.length} matches for ${id}`);
    return successResponse(matches);
  } catch (error) {
    const { id } = params;
    logger.error('Failed to fetch player matches', error, { playerId: id });
    return commonErrors.internalServerError('Failed to fetch player matches');
  }
}