// Integration layer between ETL pipeline and Next.js API routes
// Place this in src/lib/etlIntegration.ts

import { db } from '@/lib/firebaseClient';
import { collection, query, where, limit, getDocs, doc, getDoc, type Firestore } from 'firebase/firestore';

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
  player_name: string;  // Add actual player name
  team: string;
  season: number;
  round_number: number;
  source: string;
  last_seen_at: string;
  stats: {
    // Core AFL Stats (using actual field names from Firebase)
    goals?: number | null;           // G
    marks?: number | null;           // M  
    tackles?: number | null;         // T
    effective_disposals?: number | null;  // ED
    kicks?: number | null;           // K
    disposal_efficiency?: number | null;  // DE
    clearances?: number | null;      // CL
    turnovers?: number | null;       // TO
    metres_gained?: number | null;   // MG
    
    // Additional stats for completeness
    handballs?: number | null;       // HB
    disposals?: number | null;       // D
    behinds?: number | null;         // B
    hitouts?: number | null;         // HO
    inside50s?: number | null;       // I50
    rebound50s?: number | null;      // R50
    contested_possessions?: number | null;  // CP
    uncontested_possessions?: number | null; // UP
    frees_for?: number | null;       // FF
    frees_against?: number | null;   // FA
    afl_fantasy?: number | null;     // AF
    supercoach?: number | null;      // SC
    time_on_ground?: number | null;  // TOG
  };
}

export interface ETLMatch {
  season: number;
  round_number: number;
  home_team: string;
  away_team: string;
  start_time_utc: string;
  status: "scheduled" | "in_progress" | "final";
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
        const results = snapshot.docs.map(doc => doc.data() as ETLPlayerStats);
        return results.sort((a, b) => 
          new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime()
        );
      }
    } catch (etlError) {
      console.warn('ETL collection query failed, falling back to players collection:', etlError);
    }
    
    // Fallback to players collection if ETL data not available
    const playersQuery = query(
      collection(firestore, 'players'),
      limit(100)
    );
    
    const playersSnapshot = await getDocs(playersQuery);
    return playersSnapshot.docs.map(doc => {
      const data = doc.data();
      
      // Get the most recent match log for current stats
      const recentMatch = data.matchLogs && data.matchLogs.length > 0 
        ? data.matchLogs[data.matchLogs.length - 1] 
        : {};
      
      return {
        match_uid: recentMatch.Match_id?.toString() || 'fallback',
        player_uid: doc.id,
        player_name: data.name || 'Unknown Player',
        team: data.team || 'Unknown',
        season: recentMatch.Season || currentSeason,
        round_number: typeof recentMatch.Round === 'string' 
          ? parseInt(recentMatch.Round.replace('Round ', '')) || 1
          : recentMatch.Round || 1,
        source: 'firebase_players_collection',
        last_seen_at: recentMatch.Date || new Date().toISOString(),
        stats: {
          // Map Firebase field names to our interface
          goals: recentMatch.G || 0,
          marks: recentMatch.M || 0,
          tackles: recentMatch.T || 0,
          effective_disposals: recentMatch.ED || 0,
          kicks: recentMatch.K || 0,
          disposal_efficiency: recentMatch.DE || 0,
          clearances: recentMatch.CL || 0,
          turnovers: recentMatch.TO || 0,
          metres_gained: recentMatch.MG || 0,
          
          // Additional stats
          handballs: recentMatch.HB || 0,
          disposals: recentMatch.D || 0,
          behinds: recentMatch.B || 0,
          hitouts: recentMatch.HO || 0,
          inside50s: recentMatch.I50 || 0,
          rebound50s: recentMatch.R50 || 0,
          contested_possessions: recentMatch.CP || 0,
          uncontested_possessions: recentMatch.UP || 0,
          frees_for: recentMatch.FF || 0,
          frees_against: recentMatch.FA || 0,
          afl_fantasy: recentMatch.AF || 0,
          supercoach: recentMatch.SC || 0,
          time_on_ground: recentMatch.TOG || 0
        }
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
    const results = snapshot.docs.map(doc => doc.data() as ETLPlayerStats);
    
    // Sort in memory instead of using Firestore orderBy
    return results.sort((a, b) => 
      new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime()
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
    return snapshot.docs.map(doc => doc.data() as ETLMatch);
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
    return snapshot.docs.map(doc => doc.data() as ETLMatch);
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
    const results = snapshot.docs.map(doc => doc.data() as ETLPlayerStats);
    
    // Sort in memory instead of using Firestore orderBy
    return results.sort((a, b) => 
      new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime()
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
    const results = snapshot.docs.map(doc => doc.data() as ETLPlayerStats);
    
    // Sort in memory instead of using Firestore orderBy
    return results.sort((a, b) => 
      new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime()
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
  
  // Core AFL Stats (your requested stats)
  goals: number;
  marks: number;
  tackles: number;
  effective_disposals: number;
  kicks: number;
  disposal_efficiency: number;
  clearances: number;
  turnovers: number;
  metres_gained: number;
  
  // Additional common stats
  handballs: number;
  disposals: number;
  behinds: number;
  hitouts: number;
  inside50s: number;
  rebound50s: number;
  contested_possessions: number;
  uncontested_possessions: number;
  
  // Scores (calculated or from source)
  fantasyScore: number;
  supercoachScore: number;
  
  // Metadata
  round: number;
  season: number;
  lastUpdated: string;
  source: string;
}

/**
 * Transform ETL stats to legacy format for backward compatibility
 */
export function transformToLegacyPlayerStats(etlStats: ETLPlayerStats[]): LegacyPlayerStat[] {
  return etlStats.map(stat => ({
    id: stat.player_uid,
    name: stat.player_name || stat.player_uid.replace('ply_', '').replace(/_/g, ' '),
    team: stat.team,
    position: 'MID', // Default position, should be enriched from player profile
    
    // Core AFL stats (your requested stats)
    goals: stat.stats.goals || 0,
    marks: stat.stats.marks || 0,
    tackles: stat.stats.tackles || 0,
    effective_disposals: stat.stats.effective_disposals || 0,
    kicks: stat.stats.kicks || 0,
    disposal_efficiency: stat.stats.disposal_efficiency || 0,
    clearances: stat.stats.clearances || 0,
    turnovers: stat.stats.turnovers || 0,
    metres_gained: stat.stats.metres_gained || 0,
    
    // Additional stats
    handballs: stat.stats.handballs || 0,
    disposals: stat.stats.disposals || 0,
    behinds: stat.stats.behinds || 0,
    hitouts: stat.stats.hitouts || 0,
    inside50s: stat.stats.inside50s || 0,
    rebound50s: stat.stats.rebound50s || 0,
    contested_possessions: stat.stats.contested_possessions || 0,
    uncontested_possessions: stat.stats.uncontested_possessions || 0,
    
    // Calculated scores
    fantasyScore: stat.stats.afl_fantasy || calculateFantasyScore(stat.stats),
    supercoachScore: stat.stats.supercoach || calculateFantasyScore(stat.stats),
    
    // Metadata
    round: stat.round_number,
    season: stat.season,
    lastUpdated: stat.last_seen_at,
    source: stat.source
  }));
}

/**
 * Calculate basic AFL fantasy score from stats
 */
function calculateFantasyScore(stats: ETLPlayerStats['stats']): number {
  // Basic AFL fantasy scoring formula using available stats
  return (
    (stats.kicks || 0) * 3 +
    (stats.handballs || 0) * 2 +
    (stats.marks || 0) * 3 +
    (stats.tackles || 0) * 4 +
    (stats.goals || 0) * 6 +
    (stats.behinds || 0) * 1 +
    (stats.hitouts || 0) * 1 +
    (stats.frees_against || 0) * -3 +
    (stats.turnovers || 0) * -4  // Use turnovers instead of clangers
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
  minutesSinceUpdate: number | null 
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
    minutesSinceUpdate
  };
}
