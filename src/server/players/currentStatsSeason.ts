import 'server-only';

import { adminDb } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

const CACHE_MS = 60 * 60 * 1000;
let cached: { season: number; at: number } | null = null;

/**
 * The current AFL stats season: the latest season in the ingested match stats, read again at most
 * hourly. Rankings, player detail and match logs all default to it. When the stats cannot be read
 * or hold nothing yet, it is the calendar year, not cached, so the next call reads again.
 */
export async function resolveCurrentStatsSeason(now = Date.now()): Promise<number> {
  if (cached && now - cached.at < CACHE_MS) return cached.season;
  const calendarYear = new Date(now).getUTCFullYear();
  try {
    const snapshot = await adminDb
      .collection('player_match_stats')
      .orderBy('season', 'desc')
      .limit(1)
      .get();
    const latest = Number(snapshot.docs[0]?.data().season);
    if (!Number.isInteger(latest) || latest <= 0) return calendarYear;
    cached = { season: latest, at: now };
    return latest;
  } catch (error) {
    logger.warn('Current stats season could not be read; using the calendar year', {
      error: error instanceof Error ? error.message : String(error),
    });
    return calendarYear;
  }
}
