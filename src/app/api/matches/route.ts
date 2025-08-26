export const runtime = 'nodejs';

import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { commonErrors, successResponse } from '@/lib/apiResponse';
import { mapMatchEventToDTO } from '@/lib/matchMapper';

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
    const snapshot = await adminDb.collection('MatchEvent').where('round', '==', round).get();

    if (snapshot.empty) {
      return successResponse([]);
    }

    const matches = snapshot.docs.map((doc) => mapMatchEventToDTO(doc.id, doc.data() as MatchEvent));

    return successResponse(matches);
  } catch (error) {
    logger.error(`Failed to fetch matches for round ${round}`, error, { round });
    return commonErrors.internalServerError('Internal server error');
  }
}
