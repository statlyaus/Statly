import { NextResponse, type NextRequest } from 'next/server';

import { getDefaultAflSeason } from '@/lib/aflSeason';
import { logger } from '@/lib/logger';
import {
  publishLeagueRosterSummaries,
  publishPlayerRankings,
  refreshPlayerReadModels,
} from '@/server/readModels/playerReadModels';

// Daily cron endpoint triggered by Vercel (see vercel.json)
// - Runs on Node.js runtime so firebase-admin and other Node libs work
// - Protected via CRON_SECRET outside local development; pass ?token=... or x-cron-secret.
export const runtime = 'nodejs';

function isAuthorized(req: NextRequest): boolean {
  const configuredToken = process.env.CRON_SECRET?.trim();
  if (!configuredToken) {
    return process.env.NODE_ENV === 'development';
  }
  const token =
    req.headers.get('x-cron-secret') ?? req.nextUrl.searchParams.get('token');
  return token === configuredToken;
}

export async function GET(req: NextRequest) {
  const started = Date.now();

  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: 'unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    const seasonParam = req.nextUrl.searchParams.get('season');
    const leagueId = req.nextUrl.searchParams.get('leagueId') ?? undefined;
    const season = seasonParam ? Number(seasonParam) : getDefaultAflSeason();
    if (!Number.isFinite(season) || !Number.isInteger(season) || season < 2020 || season > 2030) {
      return NextResponse.json(
        { ok: false, error: 'invalid season' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const refreshResult = await refreshPlayerReadModels({
      season,
      leagueId,
    });
    const rankingResult = await publishPlayerRankings({
      season,
    });
    const rosterResult = await publishLeagueRosterSummaries({
      season,
      leagueId,
    });

    const ranAt = new Date().toISOString();
    const durationMs = Date.now() - started;
    logger.info('Daily cron job ran', {
      ranAt,
      durationMs,
      season,
      leagueId,
      refreshResult,
      rankingResult,
      rosterResult,
    });

    return NextResponse.json(
      { ok: true, ranAt, durationMs, season, leagueId, refreshResult, rankingResult, rosterResult },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const isProd = process.env.NODE_ENV === 'production';
    const errorLog: Record<string, unknown> = { message };
    if (!isProd && err instanceof Error && err.stack) {
      errorLog.stack = err.stack;
    }
    // Log details server-side; stack only in non-production
    logger.error(
      'Daily cron job failed',
      err instanceof Error ? err : new Error(String(err)),
      errorLog
    );

    return NextResponse.json(
      { ok: false, error: message, ranAt: new Date().toISOString() },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
