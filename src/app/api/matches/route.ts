export const runtime = 'nodejs';

import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { commonErrors, successResponse } from '@/lib/apiResponse';

interface MatchEvent {
  matchDate: FirebaseFirestore.Timestamp | Date;
  homeTeam: string;
  awayTeam: string;
  scoreHome?: number;
  scoreAway?: number;
  round: number;
}

export async function GET(request: NextRequest) {
  const roundParam = request.nextUrl.searchParams.get('round');
  const round = Number(roundParam);
  if (!Number.isInteger(round) || round <= 0) {
    return commonErrors.badRequest('Invalid round parameter');
  }

  try {
    const snapshot = await adminDb
      .collection('MatchEvent')
      .where('round', '==', round)
      .get();

    if (snapshot.empty) {
      return successResponse([]);
    }

    const matches = snapshot.docs.map((doc) => {
      const data = doc.data() as MatchEvent;
      const matchDate =
        data.matchDate instanceof Date
          ? data.matchDate.toISOString()
          : data.matchDate?.toDate()
            ? data.matchDate.toDate().toISOString()
            : null;
      return {
        matchDate,
        homeTeam: data.homeTeam,
        awayTeam: data.awayTeam,
        scoreHome: data.scoreHome ?? null,
        scoreAway: data.scoreAway ?? null,
        round: data.round,
      };
    });

    return successResponse(matches);
  } catch (error) {
    logger.error(`Failed to fetch matches for round ${round}`, error, { round });
    return commonErrors.internalServerError('Internal server error');
  }
}
