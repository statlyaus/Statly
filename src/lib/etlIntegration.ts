// src/lib/etlIntegration.ts
import 'server-only';
// Integration layer between ETL pipeline and Next.js API routes (Admin SDK only)

import { adminDb } from '@/lib/firebaseAdmin';
import { isRealMatch } from '@/lib/matchGuard';
import type { LegacyPlayerStat } from '@/types/fantasy';

import type { Firestore } from 'firebase-admin/firestore';

// Re-export a db alias so existing imports `{ db } from '@/lib/etlIntegration'` keep working
export const db = adminDb;

// ---- Types ----

export interface ETLPlayerStats {
  match_uid: string;
  player_uid: string;
  team: string;
  season: number;
  round_number: number;
  source: string;
  last_seen_at: string; // ISO
  stats: {
    kicks?: number | null;
    handballs?: number | null;
    disposals?: number | null;
    marks?: number | null;
    tackles?: number | null;
    goals?: number | null;
    behinds?: number | null;
    hitouts?: number | null;
    clearances?: number | null;
    inside50s?: number | null;
    rebound50s?: number | null;
    clangers?: number | null;
    contested_possessions?: number | null;
    uncontested_possessions?: number | null;
    frees_for?: number | null;
    frees_against?: number | null;
    one_percenters?: number | null;
    goal_assists?: number | null;
    turnovers?: number | null;
    intercepts?: number | null;
    metres_gained?: number | null;
    contested_marks?: number | null;
    effective_disposals?: number | null;
    score_involvements?: number | null;
    minutes?: number | null;
    tog_pct?: number | null;
  };
}

export interface ETLMatch {
  id?: string;
  match_uid?: string;
  season: number;
  round_number: number;
  home_team: string;
  away_team: string;
  start_time_utc: string;
  status: 'scheduled' | 'in_progress' | 'final';
  home_score?: number | null;
  away_score?: number | null;
  home_score_breakdown?: string | null;
  away_score_breakdown?: string | null;
  current_quarter?: number | null;
  live_clock_text?: string | null;
  venue?: string | null;
  updated_at?: string | null;
  last_seen_at?: string | null;
  provider_ids?: Record<string, unknown>;
}

export interface ETLPlayer {
  full_name: string;
  current_team: string;
  positions: string[];
  provider_ids?: Record<string, unknown>;
}

// ---- Internal ----

function getFirestore(): Firestore {
  // adminDb is initialized in '@/lib/firebaseAdmin'
  if (!adminDb) {
    throw new Error('[etlIntegration] admin Firestore not initialized');
  }
  return adminDb;
}

function byMostRecent(a: { last_seen_at?: string }, b: { last_seen_at?: string }) {
  return new Date(b.last_seen_at ?? 0).getTime() - new Date(a.last_seen_at ?? 0).getTime();
}

// ---- Queries (Admin SDK) ----

/** Get live player statistics for the current season (ETL first, fallback to players) */
export async function getLivePlayerStats(season?: number): Promise<ETLPlayerStats[]> {
  const currentSeason = season || new Date().getFullYear();
  const firestore = getFirestore();

  try {
    // Prefer ETL collection
    const etlSnap = await firestore
      .collection('player_match_stats')
      .where('season', '==', currentSeason)
      .limit(500)
      .get();

    if (!etlSnap.empty) {
      const results = etlSnap.docs.map((d) => d.data() as ETLPlayerStats);
      return results.sort(byMostRecent);
    }
  } catch (err) {
    console.warn('[etlIntegration] ETL query failed; falling back to players:', err);
  }

  // Fallback: synthesize minimal stats from players collection
  const playersSnap = await firestore.collection('players').limit(100).get();
  return playersSnap.docs.map((doc) => {
    const data = doc.data() as any;
    return {
      match_uid: 'fallback',
      player_uid: doc.id,
      team: data.team ?? 'Unknown',
      season: currentSeason,
      round_number: 1,
      source: 'firebase_fallback',
      last_seen_at: new Date().toISOString(),
      stats: {
        kicks: data.kicks ?? 0,
        handballs: data.handballs ?? 0,
        disposals: data.disposals ?? 0,
        marks: data.marks ?? 0,
        tackles: data.tackles ?? 0,
        goals: data.goals ?? 0,
        behinds: data.behinds ?? 0,
        hitouts: data.hitouts ?? 0,
        clearances: data.clearances ?? 0,
        inside50s: data.inside50s ?? 0,
        rebound50s: data.rebound50s ?? 0,
        clangers: data.clangers ?? 0,
        contested_possessions: data.contested_possessions ?? 0,
        uncontested_possessions: data.uncontested_possessions ?? 0,
        frees_for: data.frees_for ?? 0,
        frees_against: data.frees_against ?? 0,
        one_percenters: data.one_percenters ?? 0,
        goal_assists: data.goal_assists ?? 0,
        turnovers: data.turnovers ?? 0,
        intercepts: data.intercepts ?? 0,
        metres_gained: data.metres_gained ?? 0,
        contested_marks: data.contested_marks ?? 0,
        effective_disposals: data.effective_disposals ?? 0,
        score_involvements: data.score_involvements ?? 0,
        minutes: data.minutes ?? 0,
        tog_pct: data.tog_pct ?? 0,
      },
    } as ETLPlayerStats;
  });
}

export async function getLivePlayerStatsPaged(params: {
  season?: number;
  limit?: number;
  cursor?: string | null;
}): Promise<{ items: ETLPlayerStats[]; nextCursor: string | null }> {
  const currentSeason = params.season || new Date().getFullYear();
  const limit = Math.max(1, Math.min(params.limit ?? 50, 500));
  const cursor = params.cursor ?? null;
  const firestore = getFirestore();

  try {
    let q = firestore
      .collection('player_match_stats')
      .where('season', '==', currentSeason)
      .orderBy('last_seen_at', 'desc')
      .limit(limit + 1);

    if (cursor) {
      q = q.startAfter(cursor);
    }

    const snap = await q.get();
    const docs = snap.docs.map((d) => d.data() as ETLPlayerStats);
    const hasMore = docs.length > limit;
    const items = hasMore ? docs.slice(0, limit) : docs;
    const nextCursor = hasMore ? String(items[items.length - 1]?.last_seen_at ?? '') || null : null;
    return { items, nextCursor };
  } catch (err) {
    console.warn('[etlIntegration] paged live stats query failed; using fallback slice:', err);
    const all = await getLivePlayerStats(currentSeason);
    const startIndex = cursor ? all.findIndex((d) => d.last_seen_at === cursor) + 1 : 0;
    const slice = all.slice(startIndex, startIndex + limit);
    const nextCursor = startIndex + limit < all.length ? slice[slice.length - 1]?.last_seen_at ?? null : null;
    return { items: slice, nextCursor };
  }
}

/** Get statistics for a specific match */
export async function getMatchPlayerStats(matchUid: string): Promise<ETLPlayerStats[]> {
  const firestore = getFirestore();
  try {
    const snap = await firestore
      .collection('player_match_stats')
      .where('match_uid', '==', matchUid)
      .limit(100)
      .get();

    const results = snap.docs.map((d) => d.data() as ETLPlayerStats);
    return results.sort(byMostRecent);
  } catch (err) {
    console.error(`[etlIntegration] match ${matchUid} stats error:`, err);
    return [];
  }
}

/** Get current live matches */
export async function getLiveMatches(): Promise<ETLMatch[]> {
  const firestore = getFirestore();
  try {
    const snap = await firestore.collection('matches').where('status', '==', 'in_progress').get();
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as ETLMatch) }))
      .filter((d) => isRealMatch(d))
      .map((d) => d as ETLMatch);
  } catch (err) {
    console.error('[etlIntegration] live matches error:', err);
    return [];
  }
}

/** Get all matches for a round */
export async function getRoundMatches(season: number, round: number): Promise<ETLMatch[]> {
  const firestore = getFirestore();
  try {
    const snap = await firestore
      .collection('matches')
      .where('season', '==', season)
      .where('round_number', '==', round)
      .get();
    return snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as ETLMatch) }))
      .filter((d) => isRealMatch(d))
      .map((d) => d as ETLMatch);
  } catch (err) {
    console.error(`[etlIntegration] ${season} R${round} matches error:`, err);
    return [];
  }
}

/** Get player profile information */
export async function getPlayerProfile(playerUid: string): Promise<ETLPlayer | null> {
  const firestore = getFirestore();
  try {
    const doc = await firestore.collection('players').doc(playerUid).get();
    return doc.exists ? (doc.data() as ETLPlayer) : null;
  } catch (err) {
    console.error(`[etlIntegration] player ${playerUid} profile error:`, err);
    return null;
  }
}

/** Get recent statistics for a player */
export async function getPlayerRecentStats(
  playerUid: string,
  limitCount: number = 10
): Promise<ETLPlayerStats[]> {
  const firestore = getFirestore();
  try {
    const snap = await firestore
      .collection('player_match_stats')
      .where('player_uid', '==', playerUid)
      .limit(limitCount)
      .get();

    const results = snap.docs.map((d) => d.data() as ETLPlayerStats);
    return results.sort(byMostRecent);
  } catch (err) {
    console.error(`[etlIntegration] player ${playerUid} recent stats error:`, err);
    return [];
  }
}

/** Get team statistics for current round */
export async function getTeamCurrentStats(
  team: string,
  season?: number
): Promise<ETLPlayerStats[]> {
  const currentSeason = season || new Date().getFullYear();
  const firestore = getFirestore();

  try {
    const snap = await firestore
      .collection('player_match_stats')
      .where('team', '==', team)
      .where('season', '==', currentSeason)
      .limit(50)
      .get();

    const results = snap.docs.map((d) => d.data() as ETLPlayerStats);
    return results.sort(byMostRecent);
  } catch (err) {
    console.error(`[etlIntegration] team ${team} current stats error:`, err);
    return [];
  }
}

// ---- Legacy transform helpers ----

export function transformToLegacyPlayerStats(
  etlStats: ETLPlayerStats[],
  profiles?: Record<string, { position?: string }>
): LegacyPlayerStat[] {
  return etlStats.map((stat) => {
    const profile = profiles?.[stat.player_uid];
    const position = profile?.position || 'MID';
    return {
      id: stat.player_uid,
      name: stat.player_uid.replace('ply_', '').replace(/_/g, ' '),
      team: stat.team,
      position,
      kicks: stat.stats.kicks ?? 0,
      handballs: stat.stats.handballs ?? 0,
      disposals: stat.stats.disposals ?? 0,
      marks: stat.stats.marks ?? 0,
      tackles: stat.stats.tackles ?? 0,
      goals: stat.stats.goals ?? 0,
      behinds: stat.stats.behinds ?? 0,
      hitouts: stat.stats.hitouts ?? 0,
      clearances: stat.stats.clearances ?? 0,
      inside50s: stat.stats.inside50s ?? 0,
      rebound50s: stat.stats.rebound50s ?? 0,
      contested_possessions: stat.stats.contested_possessions ?? 0,
      uncontested_possessions: stat.stats.uncontested_possessions ?? 0,
      fantasyScore: calculateFantasyScore(stat.stats),
      round: stat.round_number,
      season: stat.season,
      lastUpdated: stat.last_seen_at,
      source: stat.source,
    };
  });
}

function calculateFantasyScore(stats: ETLPlayerStats['stats']): number {
  return (
    (stats.kicks ?? 0) * 3 +
    (stats.handballs ?? 0) * 2 +
    (stats.marks ?? 0) * 3 +
    (stats.tackles ?? 0) * 4 +
    (stats.goals ?? 0) * 6 +
    (stats.behinds ?? 0) * 1 +
    (stats.hitouts ?? 0) * 1 +
    (stats.frees_against ?? 0) * -3 +
    (stats.clangers ?? 0) * -4
  );
}

// ---- Utilities ----

/** Is there live data (any in-progress matches)? */
export async function isLiveDataAvailable(): Promise<boolean> {
  const liveMatches = await getLiveMatches();
  return liveMatches.length > 0;
}

/** Data freshness indicator */
export async function getDataFreshness(): Promise<{
  isLive: boolean;
  lastUpdate: string | null;
  minutesSinceUpdate: number | null;
}> {
  const isLive = await isLiveDataAvailable();
  if (!isLive) return { isLive: false, lastUpdate: null, minutesSinceUpdate: null };

  const recentStats = await getLivePlayerStats();
  if (recentStats.length === 0) {
    return { isLive: true, lastUpdate: null, minutesSinceUpdate: null };
  }

  const mostRecent = recentStats[0].last_seen_at;
  const lastUpdate = new Date(mostRecent);
  const minutesSinceUpdate = Math.floor((Date.now() - lastUpdate.getTime()) / 60_000);

  return { isLive: true, lastUpdate: mostRecent, minutesSinceUpdate };
}

/** Build a simple player profile map for positions */
export async function getPlayerProfilesMap(): Promise<Record<string, { position?: string }>> {
  const firestore = getFirestore();
  try {
    const snap = await firestore.collection('players').get();
    const map: Record<string, { position?: string }> = {};
    snap.forEach((d) => {
      const data = d.data() as {
        primaryPosition?: string;
        position?: string;
        positions?: string[];
      };
      map[d.id] = {
        position: data?.primaryPosition || data?.position || data?.positions?.[0],
      };
    });
    return map;
  } catch (err) {
    console.error('[etlIntegration] build player profiles map error:', err);
    return {};
  }
}

export async function getLegacyLivePlayerStats(): Promise<LegacyPlayerStat[]> {
  const [etl, profiles] = await Promise.all([
    getLivePlayerStats(),
    getPlayerProfilesMap(),
  ]);
  return transformToLegacyPlayerStats(etl, profiles);
}
