// Integration layer between ETL pipeline and Next.js API routes
// Place this in src/lib/etlIntegration.ts

import { db } from '@/lib/firebaseClient';
import {
  collection,
  query,
  where,
  limit,
  getDocs,
  doc,
  getDoc,
  type Firestore,
} from 'firebase/firestore';

// Helper function to check if Firebase is available
function getFirestore(): Firestore {
  if (!db) {
    throw new Error('Firebase is not initialized. Please check your Firebase configuration.');
  }
  return db;
}

export interface ETLPlayerStats {
  match_uid: string;
  player_uid: string;
  team: string;
  season: number;
  round_number: number;
  source: string;
  last_seen_at: string;
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

/**
 * Get live player statistics for the current round
 */
export async function getLivePlayerStats(season?: number): Promise<ETLPlayerStats[]> {
  const currentSeason = season || new Date().getFullYear();

  try {
    const firestore = getFirestore();

    // Try the ETL collection first
    try {
      const statsQuery = query(
        collection(firestore, 'player_match_stats'),
        where('season', '==', currentSeason),
        limit(500)
      );

      const snapshot = await getDocs(statsQuery);
      if (snapshot.size > 0) {
        const results = snapshot.docs.map((doc) => doc.data() as ETLPlayerStats);
        return results.sort(
          (a, b) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime()
        );
      }
    } catch (etlError) {
      console.warn('ETL collection query failed, falling back to players collection:', etlError);
    }

    // Fallback to players collection if ETL data not available
    const playersQuery = query(collection(firestore, 'players'), limit(100));

    const playersSnapshot = await getDocs(playersQuery);
    return playersSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        match_uid: 'fallback',
        player_uid: doc.id,
        team: data.team || 'Unknown',
        season: currentSeason,
        round_number: 1,
        source: 'firebase_fallback',
        last_seen_at: new Date().toISOString(),
        stats: {
          kicks: data.kicks || 0,
          handballs: data.handballs || 0,
          disposals: data.disposals || 0,
          marks: data.marks || 0,
          tackles: data.tackles || 0,
          goals: data.goals || 0,
          behinds: data.behinds || 0,
          hitouts: data.hitouts || 0,
          clearances: data.clearances || 0,
          inside50s: data.inside50s || 0,
          rebound50s: data.rebound50s || 0,
          clangers: data.clangers || 0,
          contested_possessions: data.contested_possessions || 0,
          uncontested_possessions: data.uncontested_possessions || 0,
          frees_for: data.frees_for || 0,
          frees_against: data.frees_against || 0,
          one_percenters: data.one_percenters || 0,
          goal_assists: data.goal_assists || 0,
          turnovers: data.turnovers || 0,
          intercepts: data.intercepts || 0,
          metres_gained: data.metres_gained || 0,
          contested_marks: data.contested_marks || 0,
          effective_disposals: data.effective_disposals || 0,
          score_involvements: data.score_involvements || 0,
          minutes: data.minutes || 0,
          tog_pct: data.tog_pct || 0,
        },
      } as ETLPlayerStats;
    });
  } catch (error) {
    console.error('Error fetching live player stats:', error);
    return [];
  }
}

/**
 * Get statistics for a specific match
 */
export async function getMatchPlayerStats(matchUid: string): Promise<ETLPlayerStats[]> {
  try {
    const firestore = getFirestore();
    // Simplified query - removed orderBy to avoid composite index requirement
    const statsQuery = query(
      collection(firestore, 'player_match_stats'),
      where('match_uid', '==', matchUid),
      limit(100) // Reasonable limit for match players
    );

    const snapshot = await getDocs(statsQuery);
    const results = snapshot.docs.map((doc) => doc.data() as ETLPlayerStats);

    // Sort in memory instead of using Firestore orderBy
    return results.sort(
      (a, b) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime()
    );
  } catch (error) {
    console.error(`Error fetching stats for match ${matchUid}:`, error);
    return [];
  }
}

/**
 * Get current live matches
 */
export async function getLiveMatches(): Promise<ETLMatch[]> {
  try {
    const firestore = getFirestore();
    const matchesQuery = query(
      collection(firestore, 'matches'),
      where('status', '==', 'in_progress')
    );

    const snapshot = await getDocs(matchesQuery);
    return snapshot.docs.map((doc) => doc.data() as ETLMatch);
  } catch (error) {
    console.error('Error fetching live matches:', error);
    return [];
  }
}

/**
 * Get all matches for a specific round
 */
export async function getRoundMatches(season: number, round: number): Promise<ETLMatch[]> {
  try {
    const firestore = getFirestore();
    const matchesQuery = query(
      collection(firestore, 'matches'),
      where('season', '==', season),
      where('round_number', '==', round)
    );

    const snapshot = await getDocs(matchesQuery);
    return snapshot.docs.map((doc) => doc.data() as ETLMatch);
  } catch (error) {
    console.error(`Error fetching matches for ${season} R${round}:`, error);
    return [];
  }
}

/**
 * Get player profile information
 */
export async function getPlayerProfile(playerUid: string): Promise<ETLPlayer | null> {
  try {
    const firestore = getFirestore();
    const playerDoc = await getDoc(doc(firestore, 'players', playerUid));
    if (playerDoc.exists()) {
      return playerDoc.data() as ETLPlayer;
    }
    return null;
  } catch (error) {
    console.error(`Error fetching player ${playerUid}:`, error);
    return null;
  }
}

/**
 * Get recent statistics for a specific player
 */
export async function getPlayerRecentStats(
  playerUid: string,
  limitCount: number = 10
): Promise<ETLPlayerStats[]> {
  try {
    const firestore = getFirestore();
    // Simplified query - removed orderBy to avoid composite index requirement
    const statsQuery = query(
      collection(firestore, 'player_match_stats'),
      where('player_uid', '==', playerUid),
      limit(limitCount)
    );

    const snapshot = await getDocs(statsQuery);
    const results = snapshot.docs.map((doc) => doc.data() as ETLPlayerStats);

    // Sort in memory instead of using Firestore orderBy
    return results.sort(
      (a, b) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime()
    );
  } catch (error) {
    console.error(`Error fetching recent stats for player ${playerUid}:`, error);
    return [];
  }
}

/**
 * Get team statistics for current round
 */
export async function getTeamCurrentStats(
  team: string,
  season?: number
): Promise<ETLPlayerStats[]> {
  const currentSeason = season || new Date().getFullYear();

  try {
    const firestore = getFirestore();
    // Simplified query - removed orderBy to avoid composite index requirement
    const statsQuery = query(
      collection(firestore, 'player_match_stats'),
      where('team', '==', team),
      where('season', '==', currentSeason),
      limit(50) // Limit to recent team stats
    );

    const snapshot = await getDocs(statsQuery);
    const results = snapshot.docs.map((doc) => doc.data() as ETLPlayerStats);

    // Sort in memory instead of using Firestore orderBy
    return results.sort(
      (a, b) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime()
    );
  } catch (error) {
    console.error(`Error fetching current stats for team ${team}:`, error);
    return [];
  }
}

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

/**
 * Transform ETL stats to legacy format for backward compatibility
 */
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
      // Core stats
      kicks: stat.stats.kicks || 0,
      handballs: stat.stats.handballs || 0,
      disposals: stat.stats.disposals || 0,
      marks: stat.stats.marks || 0,
      tackles: stat.stats.tackles || 0,
      goals: stat.stats.goals || 0,
      behinds: stat.stats.behinds || 0,
      // Advanced stats
      hitouts: stat.stats.hitouts || 0,
      clearances: stat.stats.clearances || 0,
      inside50s: stat.stats.inside50s || 0,
      rebound50s: stat.stats.rebound50s || 0,
      contested_possessions: stat.stats.contested_possessions || 0,
      uncontested_possessions: stat.stats.uncontested_possessions || 0,
      // Calculated fantasy score
      fantasyScore: calculateFantasyScore(stat.stats),
      // Metadata
      round: stat.round_number,
      season: stat.season,
      lastUpdated: stat.last_seen_at,
      source: stat.source,
    };
  });
}

/**
 * Calculate basic AFL fantasy score from stats
 */
function calculateFantasyScore(stats: ETLPlayerStats['stats']): number {
  // Basic AFL fantasy scoring formula
  return (
    (stats.kicks || 0) * 3 +
    (stats.handballs || 0) * 2 +
    (stats.marks || 0) * 3 +
    (stats.tackles || 0) * 4 +
    (stats.goals || 0) * 6 +
    (stats.behinds || 0) * 1 +
    (stats.hitouts || 0) * 1 +
    (stats.frees_against || 0) * -3 +
    (stats.clangers || 0) * -4
  );
}

/**
 * Check if live data is available (matches in progress)
 */
export async function isLiveDataAvailable(): Promise<boolean> {
  const liveMatches = await getLiveMatches();
  return liveMatches.length > 0;
}

/**
 * Get data freshness indicator
 */
export async function getDataFreshness(): Promise<{
  isLive: boolean;
  lastUpdate: string | null;
  minutesSinceUpdate: number | null;
}> {
  const isLive = await isLiveDataAvailable();

  if (!isLive) {
    return { isLive: false, lastUpdate: null, minutesSinceUpdate: null };
  }

  const recentStats = await getLivePlayerStats();
  if (recentStats.length === 0) {
    return { isLive: true, lastUpdate: null, minutesSinceUpdate: null };
  }

  const mostRecent = recentStats[0].last_seen_at;
  const lastUpdate = new Date(mostRecent);
  const minutesSinceUpdate = Math.floor((Date.now() - lastUpdate.getTime()) / 60000);

  return {
    isLive: true,
    lastUpdate: mostRecent,
    minutesSinceUpdate,
  };
}

/**
 * Get player profiles map for enriching positions
 */
export async function getPlayerProfilesMap(): Promise<Record<string, { position?: string }>> {
  try {
    const firestore = getFirestore();
    const snapshot = await getDocs(collection(firestore, 'players'));
    const map: Record<string, { position?: string }> = {};
    snapshot.forEach((docSnap) => {
      const data = docSnap.data() as {
        primaryPosition?: string;
        position?: string;
        positions?: string[];
      };
      map[docSnap.id] = {
        position: data?.primaryPosition || data?.position || data?.positions?.[0],
      };
    });
    return map;
  } catch (error) {
    console.error('Error building player profiles map:', error);
    return {};
  }
}
