export const runtime = 'nodejs';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

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
    return NextResponse.json(
      { message: 'Invalid round parameter' },
      { status: 400 }
    );
  }

  try {
    const snapshot = await adminDb
      .collection('MatchEvent')
      .where('round', '==', round)
      .get();

    if (snapshot.empty) {
      return NextResponse.json([]);
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
      };
    });

    return NextResponse.json(matches);
  } catch (error) {
    console.error('Error fetching matches', error);
    return NextResponse.json(
      { message: 'Internal server error', error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
