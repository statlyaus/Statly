import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { adminDb } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { withMetrics } from '@/lib/metrics';
import { withRateLimit, rateLimitConfigs } from '@/lib/rateLimit';

export const runtime = 'nodejs';

function parseSeasons(raw: string | null): number[] {
  if (!raw) return [];
  const seasons = raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  return Array.from(new Set(seasons));
}

async function countForSeason(season: number): Promise<number | null> {
  try {
    const query = adminDb.collection('player_match_stats').where('season', '==', season);
    const countFn = (query as any).count;
    if (typeof countFn === 'function') {
      const snap = await (query as any).count().get();
      return Number(snap.data().count || 0);
    }
    const snap = await query.select('season').get();
    return snap.size;
  } catch (error) {
    logger.warn('etl/status season count failed', {
      season,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export const GET = withMetrics(async (request: NextRequest) => {
  const guard = await withRateLimit(rateLimitConfigs.public)(request);
  if (!guard.success) {
    return NextResponse.json(guard.body, {
      status: guard.status as number,
      headers: guard.headers as Record<string, string>,
    });
  }

  try {
    const { searchParams } = new URL(request.url);
    const seasonsParam = searchParams.get('seasons');
    const seasons =
      parseSeasons(seasonsParam).length > 0
        ? parseSeasons(seasonsParam)
        : [new Date().getFullYear()];

    const latestSnap = await adminDb
      .collection('player_match_stats')
      .orderBy('last_seen_at', 'desc')
      .limit(1)
      .get();

    const latestDoc = latestSnap.docs[0]?.data();
    const latest = latestDoc
      ? {
          player_uid: latestDoc.player_uid ?? null,
          match_uid: latestDoc.match_uid ?? latestDoc.match_id ?? latestDoc.matchUid ?? null,
          last_seen_at: latestDoc.last_seen_at ?? null,
          data_source: latestDoc.data_source ?? null,
        }
      : null;

    const counts = await Promise.all(
      seasons.map(async (season) => ({
        season,
        count: await countForSeason(season),
      }))
    );

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      latest,
      counts,
    });
  } catch (error) {
    logger.error('etl/status failed', error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json(
      { success: false, error: 'Failed to fetch ETL status' },
      { status: 500 }
    );
  }
}, 'GET /api/etl/status');
