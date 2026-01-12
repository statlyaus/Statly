import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { adminDb } from '@/lib/firebaseAdmin';
import { logger, withTiming } from '@/lib/logger';
import { withMetrics } from '@/lib/metrics';
import { withRateLimit, rateLimitConfigs } from '@/lib/rateLimit';

export interface LivePlayerStats {
  player_uid: string;
  stats: Record<string, number | null>;
  last_seen_at: string;
}

export interface LivePlayerStatsResponse {
  matchUid: string;
  players: LivePlayerStats[];
  count: number;
  message: string;
  lastUpdated?: string;
  source?: string;
}

/**
 * GET /api/live-player-stats?matchUid={matchUid}
 * Returns live player statistics for a specific match
 */
export const runtime = 'nodejs';
export const GET = withMetrics(async (request: NextRequest): Promise<NextResponse> => {
  const guard = await withRateLimit(rateLimitConfigs.public)(request);
  if (!guard.success) {
    return NextResponse.json(guard.body, {
      status: guard.status,
      headers: guard.headers as Record<string, string>,
    });
  }
  try {
    const { searchParams } = new URL(request.url);
    const matchUid = searchParams.get('matchUid');

    if (!matchUid) {
      return NextResponse.json({ error: 'matchUid parameter is required' }, { status: 400 });
    }

    logger.apiRequest('GET', '/api/live-player-stats', { matchUid });

    // Query Firestore for player stats for this match
    const snapshot = await withTiming('live-player-stats.query', async () =>
      adminDb.collection('player_match_stats').where('match_uid', '==', matchUid).get()
    );

    logger.info('live-player-stats fetched', { count: snapshot.size });

    if (snapshot.empty) {
      return NextResponse.json<LivePlayerStatsResponse>({
        matchUid,
        players: [],
        count: 0,
        message: 'No player stats found for this match',
      });
    }

    // Transform documents to response format
    const players: LivePlayerStats[] = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        player_uid: data.player_uid ?? doc.id,
        stats: data.stats || {},
        last_seen_at: data.updated_at ?? data.last_seen_at ?? new Date().toISOString(),
      };
    });

    return NextResponse.json<LivePlayerStatsResponse>(
      {
        matchUid,
        players,
        count: players.length,
        lastUpdated: new Date().toISOString(),
        source: 'footywire_fitzroy',
        message: 'player stats found',
      },
      { headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' } }
    );
  } catch (error) {
    logger.apiError('GET', '/api/live-player-stats', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch live player stats',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}, 'GET /api/live-player-stats');
