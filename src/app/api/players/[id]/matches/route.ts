export const runtime = 'nodejs';

import { type NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { commonErrors, successResponse } from '@/lib/apiResponse';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    
    // Query player match stats for the specific player
    const snapshot = await adminDb
      .collection('player_match_stats')
      .where('player_name', '==', decodeURIComponent(id))
      .orderBy('round', 'desc')
      .get();

    if (snapshot.empty) {
      return successResponse([]);
    }

    const matches = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        round: data.round,
        opposition: data.team || 'Unknown',
        opponent: data.team || 'Unknown',
        fantasyScore: data.supercoach_score || 0,
        totalValue: data.total_value || 0,
        stats: data.stats || {},
        season: data.season || 2025,
        matchDate: data.match_date || null,
      };
    });

    return successResponse(matches);
  } catch (error) {
    const { id } = await params;
    logger.error('Failed to fetch player matches', error, { playerId: id });
    return commonErrors.internalServerError('Failed to fetch player matches');
  }
}