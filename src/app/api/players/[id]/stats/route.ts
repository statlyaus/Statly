export const runtime = 'nodejs';

import { type NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { commonErrors, successResponse } from '@/lib/apiResponse';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    
    // Query player match stats for aggregation
    const snapshot = await adminDb
      .collection('player_match_stats')
      .where('player_name', '==', decodeURIComponent(id))
      .get();

    if (snapshot.empty) {
      return commonErrors.notFound('Player stats not found');
    }

    // Aggregate stats
    let totalGames = 0;
    let totalScore = 0;
    let totalGoals = 0;
    let totalDisposals = 0;
    let totalMarks = 0;
    let totalTackles = 0;
    let latestRound = 0;
    let team = '';
    let position = '';
    
    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      totalGames++;
      totalScore += data.supercoach_score || 0;
      totalGoals += data.stats?.goals || 0;
      totalDisposals += data.stats?.disposals || 0;
      totalMarks += data.stats?.marks || 0;
      totalTackles += data.stats?.tackles || 0;
      latestRound = Math.max(latestRound, data.round || 0);
      
      if (data.team) team = data.team;
      if (data.position) position = data.position;
    });

    const playerStats = {
      playerName: decodeURIComponent(id),
      team,
      position,
      totalGames,
      averageScore: totalGames > 0 ? Math.round(totalScore / totalGames) : 0,
      totalScore,
      latestRound,
      averageStats: {
        goals: totalGames > 0 ? Math.round((totalGoals / totalGames) * 10) / 10 : 0,
        disposals: totalGames > 0 ? Math.round((totalDisposals / totalGames) * 10) / 10 : 0,
        marks: totalGames > 0 ? Math.round((totalMarks / totalGames) * 10) / 10 : 0,
        tackles: totalGames > 0 ? Math.round((totalTackles / totalGames) * 10) / 10 : 0,
      },
    };

    return successResponse(playerStats);
  } catch (error) {
    const { id } = await params;
    logger.error('Failed to fetch player stats', error, { playerId: id });
    return commonErrors.internalServerError('Failed to fetch player stats');
  }
}