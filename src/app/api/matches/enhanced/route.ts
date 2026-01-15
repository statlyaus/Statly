import { type NextRequest, NextResponse } from 'next/server';

import { adminDb } from '@/lib/firebaseAdmin';
import { logger, withTiming } from '@/lib/logger';
import { withMetrics } from '@/lib/metrics';
import { isRealMatch } from '@/lib/matchGuard';

export const runtime = 'nodejs';
export const preferredRegion = ['syd1', 'iad1'];

// Narrow type for player_match_stats documents supporting legacy and variant match id keys
interface BaseStatsDoc {
  id: string;
  season?: number;
  round_number?: number;
  team?: string;
  player_uid?: string;
  player_name?: string;
  stats?: Record<string, unknown>;
  [key: string]: unknown;
}

export type StatsDoc =
  | (BaseStatsDoc & { match_id: string })
  | (BaseStatsDoc & { matchUid: string })
  | (BaseStatsDoc & { matchId: string });

function getMatchKey(doc: unknown): string | null {
  if (doc && typeof doc === 'object') {
    const o = doc as Record<string, unknown>;
    const v = o['match_id'] ?? o['matchUid'] ?? o['matchId'] ?? o['match_uid'];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

export const GET = withMetrics(async (...args: unknown[]): Promise<NextResponse> => {
  const request = args[0] as NextRequest;
  try {
    const db = adminDb;
    const { searchParams } = new URL(request.url);
    const season = searchParams.get('season') || '2025';
    const round = searchParams.get('round');
    logger.apiRequest('GET', '/api/matches/enhanced', { season, round });

    // Query matches collection
    let matchQuery = db.collection('matches').where('season', '==', parseInt(season));

    if (round) {
      matchQuery = matchQuery.where('round_number', '==', parseInt(round));
    }

    const matchSnapshot = await withTiming('matches.list', () => matchQuery.limit(50).get());
    const matches = matchSnapshot.docs
      .map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))
      .filter((match) => isRealMatch(match as Record<string, unknown>));

    // Batch fetch player stats to avoid N+1
    const matchIds = matches.map((m) => m.id);
    const chunks: string[][] = [];
    for (let i = 0; i < matchIds.length; i += 30) chunks.push(matchIds.slice(i, i + 30));

    const matchIdFields = ['match_id', 'matchUid', 'matchId'] as const;

    const tasks = matchIdFields.flatMap((field) =>
      chunks.map((c) => ({
        field,
        chunkSize: c.length,
        promise: db.collection('player_match_stats').where(field, 'in', c).get(),
      }))
    );

    const settled = await withTiming('player_match_stats.batch', () =>
      Promise.allSettled(tasks.map((t) => t.promise))
    );

    const snapshots = [] as FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>[];
    settled.forEach((result, idx) => {
      const meta = tasks[idx];
      if (result.status === 'fulfilled') {
        snapshots.push(result.value);
      } else {
        // Gracefully continue when an index is missing or another per-field error occurs
        logger.warn?.('player_match_stats query failed for field', {
          field: meta.field,
          chunkSize: meta.chunkSize,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });

    // Merge and deduplicate results by document ID
    const seenStatDocIds = new Set<string>();
    const statsDocs = [] as Array<Record<string, unknown>>;
    for (const snap of snapshots) {
      for (const d of snap.docs) {
        if (seenStatDocIds.has(d.id)) continue;
        seenStatDocIds.add(d.id);
        statsDocs.push({ id: d.id, ...d.data() });
      }
    }

    const byMatch = new Map<string, StatsDoc[]>();
    for (const s of statsDocs) {
      const key = getMatchKey(s);
      if (!key) continue;
      if (!byMatch.has(key)) byMatch.set(key, []);
      byMatch.get(key)!.push(s as StatsDoc);
    }

    const enhancedMatches = matches.map((match) => {
      const playerStats = byMatch.get(match.id) ?? [];
      return {
        ...match,
        player_stats: playerStats,
        player_count: playerStats.length,
      };
    });

    const res = NextResponse.json(
      {
        success: true,
        data: enhancedMatches,
        count: enhancedMatches.length,
        timestamp: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } }
    );
    logger.info('matches/enhanced returning', { count: enhancedMatches.length });
    return res;
  } catch (error) {
    logger.apiError('GET', '/api/matches/enhanced', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch enhanced matches',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}, 'GET /api/matches/enhanced');
