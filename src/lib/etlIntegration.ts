// src/lib/etlIntegration.ts
import 'server-only';
// Integration layer between ETL pipeline and Next.js API routes (Admin SDK only)

import { adminDb } from '@/lib/firebaseAdmin';

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
  season: number;
  round_number: number;
  home_team: string;
  away_team: string;
  start_time_utc: string;
  status: 'scheduled' | 'in_progress' | 'final';
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
    return snap.docs.map((d) => d.data() as ETLMatch);
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
    return snap.docs.map((d) => d.data() as ETLMatch);
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

export interface LegacyPlayerStat {
  id: string;
  name: string;
  team: string;
  position: string;
  kicks: number;
  handballs: number;
  disposals: number;
  marks: number;
  tackles: number;
  goals: number;
  behinds: number;
  hitouts: number;
  clearances: number;
  inside50s: number;
  rebound50s: number;
  contested_possessions: number;
  uncontested_possessions: number;
  fantasyScore: number;
  round: number;
  season: number;
  lastUpdated: string;
  source: string;
}

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

import type { LivePlayerRow } from '@/types/live';

const nameFromUid = (uid: string) => uid.replace(/^ply_/, '').replace(/_/g, ' ');

export function mapToLiveRows(
  etl: ETLPlayerStats[],
  profiles: Record<string, { position?: string; full_name?: string }> = {}
): LivePlayerRow[] {
  return etl.map((r) => {
    const kicks = r.stats.kicks ?? 0;
    const handballs = r.stats.handballs ?? 0;
    const disposals = r.stats.disposals ?? (kicks + handballs);

    return {
      playerUid: r.player_uid,
      name: profiles[r.player_uid]?.full_name ?? nameFromUid(r.player_uid),
      team: r.team,
      position: profiles[r.player_uid]?.position ?? 'MID',
      season: r.season,
      round: r.round_number,
      matchUid: r.match_uid,
      source: r.source,
      lastUpdated: r.last_seen_at,

      disposals,
      goals: r.stats.goals ?? 0,
      kicks,
      handballs,
      marks: r.stats.marks ?? 0,
      tackles: r.stats.tackles ?? 0,

      behinds: r.stats.behinds ?? undefined,
      hitouts: r.stats.hitouts ?? undefined,
      clearances: r.stats.clearances ?? undefined,
      inside50s: r.stats.inside50s ?? undefined,
      rebound50s: r.stats.rebound50s ?? undefined,
      clangers: r.stats.clangers ?? undefined,
      contested_possessions: r.stats.contested_possessions ?? undefined,
      uncontested_possessions: r.stats.uncontested_possessions ?? undefined,
      frees_for: r.stats.frees_for ?? undefined,
      frees_against: r.stats.frees_against ?? undefined,
      intercepts: r.stats.intercepts ?? undefined,
      metres_gained: r.stats.metres_gained ?? undefined,
      contested_marks: r.stats.contested_marks ?? undefined,
      score_involvements: r.stats.score_involvements ?? undefined,
      minutes: r.stats.minutes ?? undefined,
      tog_pct: r.stats.tog_pct ?? undefined,
    };
  });
}

export async function getLivePlayerRows(): Promise<LivePlayerRow[]> {
  const [raw, profiles] = await Promise.all([
    getLivePlayerStats(),
    getPlayerProfilesMap(),
  ]);
  return mapToLiveRows(raw, profiles);
}
