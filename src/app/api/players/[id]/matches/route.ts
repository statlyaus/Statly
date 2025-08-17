export const runtime = 'nodejs';

import { type NextRequest } from 'next/server';
import { logger } from '@/lib/logger';
import { commonErrors, successResponse } from '@/lib/apiResponse';
import { adminDb } from '@/lib/firebaseAdmin';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    
    // Get all match records for this player
    const matchesRef = adminDb.collection('player_match_stats');
    const snapshot = await matchesRef
      .where('player_name', '==', id) // Using player name as identifier for now
      .orderBy('round', 'desc')
      .get();

    if (snapshot.empty) {
      return commonErrors.notFound('No match data found for this player');
    }

    const matches = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        round: data.round,
        date: data.date,
        venue: data.venue,
        team: data.team,
        opposition: data.opposition,
        fantasyScore: data.supercoach_score || 0,
        totalValue: data.player_value || 0,
        
        // Core stats
        disposals: data.disposals || 0,
        kicks: data.kicks || 0,
        handballs: data.handballs || 0,
        marks: data.marks || 0,
        goals: data.goals || 0,
        behinds: data.behinds || 0,
        tackles: data.tackles || 0,
        hitouts: data.hitouts || 0,
        
        // Advanced stats
        inside50s: data.inside_50s || 0,
        rebound50s: data.rebound_50s || 0,
        clangers: data.clangers || 0,
        contestedPossessions: data.contested_possessions || 0,
        uncontestePossessions: data.uncontested_possessions || 0,
        effectiveDisposals: data.effective_disposals || 0,
        disposalEfficiency: data.disposal_efficiency || 0,
        contestedMarks: data.contested_marks || 0,
        intercepts: data.intercepts || 0,
      };
    });

    logger.info(`Retrieved ${matches.length} matches for player: ${id}`);
    return successResponse({ matches, total: matches.length });

  } catch (error) {
    const { id } = await params;
    logger.error('Failed to fetch player matches', error, { playerId: id });
    return commonErrors.internalServerError('Failed to fetch player matches');
  }
}
