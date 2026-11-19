// Integration layer between ETL pipeline and Next.js API routes
// Place this in src/lib/etlIntegration.ts

import { db } from '@/lib/firebase/clientFirestore';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';
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
  /** The name the ETL stored; older callers derive one from `player_uid`. */
  player_name?: string;
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
    /** The ETL writes these three in snake case (etl/normalizePlayerRow.ts). */
    hit_outs?: number | null;
    inside_50s?: number | null;
    rebound_50s?: number | null;
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
  match_uid: string;
  season: number;
  round_number: number;
  home_team: string;
  away_team: string;
  start_time_utc: string;
  status: 'scheduled' | 'in_progress' | 'final';
  confirmed_bye_teams?: string[];
  provider_ids?: Record<string, unknown>;
}

export type ETLRoundMatchesResult =
  { ok: true; matches: ETLMatch[] } | { ok: false; error: unknown };

export type ETLRoundPlayerStatsResult =
  { ok: true; stats: ETLPlayerStats[] } | { ok: false; error: unknown };

export interface ETLPlayer {
  full_name: string;
  current_team: string;
  positions: string[];
  provider_ids?: Record<string, unknown>;
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
 * Get all matches for a specific round
 */
export async function getRoundMatchesResult(
  season: number,
  round: number
): Promise<ETLRoundMatchesResult> {
  try {
    const firestore = getFirestore();
    const matchesQuery = query(
      collection(firestore, 'matches'),
      where('season', '==', season),
      where('round_number', '==', round)
    );

    const snapshot = await getDocs(matchesQuery);
    return { ok: true, matches: snapshot.docs.map((doc) => doc.data() as ETLMatch) };
  } catch (error) {
    console.error(`Error fetching matches for ${season} R${round}:`, error);
    return { ok: false, error };
  }
}

export async function getRoundMatches(season: number, round: number): Promise<ETLMatch[]> {
  const result = await getRoundMatchesResult(season, round);
  return result.ok ? result.matches : [];
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

export type NineCategoryKey = (typeof REAL_DATA_NINE_CATEGORY_PRESET)[number];

export interface LegacyPlayerStat {
  id: string;
  name: string;
  team: string;
  position: string;
  /** The nine league categories; null when the provider did not report the stat. */
  categories: Record<NineCategoryKey, number | null>;
  hitouts: number | null;
  round: number;
  season: number;
  lastUpdated: string;
  source: string;
}

type ETLStatKey = keyof ETLPlayerStats['stats'];

// The ETL's keys for each category, snake case first (what etl/normalizePlayerRow.ts writes).
const NINE_CATEGORY_ETL_KEYS: Record<NineCategoryKey, ETLStatKey[]> = {
  goals: ['goals'],
  tackles: ['tackles'],
  inside50s: ['inside_50s', 'inside50s'],
  intercepts: ['intercepts'],
  contestedMarks: ['contested_marks'],
  rebound50s: ['rebound_50s', 'rebound50s'],
  contestedPossessions: ['contested_possessions'],
  effectiveDisposals: ['effective_disposals'],
  scoreInvolvements: ['score_involvements'],
};

function readStat(stats: ETLPlayerStats['stats'], keys: ETLStatKey[]): number | null {
  for (const key of keys) {
    const value = stats[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * Transform ETL stats to the Match Centre's player rows: the nine categories and hit-outs, with
 * null (shown as "-") for a stat the provider did not report.
 */
export function transformToLegacyPlayerStats(
  etlStats: ETLPlayerStats[],
  profiles?: Record<string, { position?: string }>
): LegacyPlayerStat[] {
  return etlStats.map((stat) => {
    const profile = profiles?.[stat.player_uid];
    // No invented position: an unknown one stays empty and the page leaves the badge out.
    const position = profile?.position ?? '';
    return {
      id: stat.player_uid,
      name: stat.player_name || stat.player_uid.replace('ply_', '').replace(/_/g, ' '),
      team: stat.team,
      position,
      categories: Object.fromEntries(
        REAL_DATA_NINE_CATEGORY_PRESET.map((key) => [
          key,
          readStat(stat.stats, NINE_CATEGORY_ETL_KEYS[key]),
        ])
      ) as Record<NineCategoryKey, number | null>,
      hitouts: readStat(stat.stats, ['hit_outs', 'hitouts']),
      round: stat.round_number,
      season: stat.season,
      lastUpdated: stat.last_seen_at,
      source: stat.source,
    };
  });
}
