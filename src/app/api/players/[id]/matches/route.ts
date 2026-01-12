export const runtime = 'nodejs';

import { type NextRequest } from 'next/server';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { adminDb } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { calculateTotalValue, type PlayerStats } from '@/types/fantasyCategories';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    logger.debug('Fetching matches for player', { playerId: id });

    // Query player match stats for the specific player
    let snapshot;
    try {
      snapshot = await adminDb
        .collection('player_match_stats')
        .where('player_name', '==', decodeURIComponent(id))
        .orderBy('round', 'desc')
        .get();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const code = (error as { code?: string | number }).code;
      if (String(code).includes('FAILED_PRECONDITION') || msg.includes('FAILED_PRECONDITION')) {
        logger.warn('Matches query requires index; falling back to unordered query', { playerId: id });
        snapshot = await adminDb
          .collection('player_match_stats')
          .where('player_name', '==', decodeURIComponent(id))
          .get();
      } else {
        throw error;
      }
    }

    logger.debug('Found match records', { playerId: id, recordCount: snapshot.size });

    if (snapshot.empty) {
      return successResponse([]);
    }

    const matches = snapshot.docs.map((doc) => {
      const data = doc.data();
      logger.debug('Processing match', { playerId: id, round: data.round, opposition: data.opposition });

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

    matches.sort((a, b) => (b.round || 0) - (a.round || 0));
    logger.debug('Returning matches', { playerId: id, matchCount: matches.length });
    return successResponse(matches);
  } catch (error) {
    const { id } = await params;
    logger.error('Failed to fetch player matches', error, { playerId: id });
    return commonErrors.internalServerError('Failed to fetch player matches');
  }
}
