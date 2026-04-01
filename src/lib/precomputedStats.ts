/**
 * Helpers for reading pre-computed season stats
 * Falls back to empty stats if not found (caller can decide to aggregate on-demand)
 */

import type { adminDb as AdminDb } from './firebaseAdmin';
import type { CanonicalStatKey } from './stats/statColumns';

export type PrecomputedSeasonStats = {
  playerId: string;
  playerName: string;
  season: number;
  gamesPlayed: number;
  stats: Record<CanonicalStatKey, number>;
  totals: Record<CanonicalStatKey, number>;
  lastUpdated: Date;
};

/**
 * Get pre-computed stats for a single player-season
 * Returns null if not found
 */
export async function getPrecomputedSeasonStats(
  db: typeof AdminDb,
  playerId: string,
  season: number
): Promise<PrecomputedSeasonStats | null> {
  const docId = `${playerId}_${season}`;
  const doc = await db.collection('player_season_stats').doc(docId).get();
  
  if (!doc.exists) return null;
  
  const data = doc.data() as Record<string, unknown>;
  return {
    playerId: String(data.playerId),
    playerName: String(data.playerName),
    season: Number(data.season),
    gamesPlayed: Number(data.gamesPlayed),
    stats: (data.stats as Record<CanonicalStatKey, number>) ?? {},
    totals: (data.totals as Record<CanonicalStatKey, number>) ?? {},
    lastUpdated: (data.lastUpdated as { toDate: () => Date })?.toDate() ?? new Date(),
  };
}

/**
 * Get pre-computed stats for multiple player-season combinations
 * Batch fetches for efficiency (Firestore getAll supports up to 10k docs)
 * Returns a Map keyed by playerId with aggregated stats across requested seasons
 */
export async function getPrecomputedStatsForPlayers(
  db: typeof AdminDb,
  playerIds: string[],
  seasons: number[]
): Promise<Map<string, { stats: Record<CanonicalStatKey, number>; totals: Record<CanonicalStatKey, number>; gamesPlayed: number }>> {
  if (playerIds.length === 0 || seasons.length === 0) {
    return new Map();
  }

  // Build all doc IDs for batch fetch
  const docIds: string[] = [];
  const docIdToMeta = new Map<string, { playerId: string; season: number }>();
  
  for (const playerId of playerIds) {
    for (const season of seasons) {
      const docId = `${playerId}_${season}`;
      docIds.push(docId);
      docIdToMeta.set(docId, { playerId, season });
    }
  }

  // Batch fetch (Firestore getAll is more efficient than individual gets)
  const docs = await db.getAll(
    ...docIds.map(id => db.collection('player_season_stats').doc(id))
  );

  // Aggregate across seasons for each player
  const aggregated = new Map<string, {
    totalGames: number;
    summedTotals: Record<CanonicalStatKey, number>;
    totals: Record<CanonicalStatKey, number>;
  }>();

  for (const doc of docs) {
    if (!doc.exists) continue;
    
    const data = doc.data() as PrecomputedSeasonStats;
    const playerId = data.playerId;
    
    const existing = aggregated.get(playerId) ?? {
      totalGames: 0,
      summedTotals: {} as Record<CanonicalStatKey, number>,
      totals: {} as Record<CanonicalStatKey, number>,
    };

    existing.totalGames += data.gamesPlayed;
    
    // Sum totals across seasons
    for (const key in data.totals) {
      const canonicalKey = key as CanonicalStatKey;
      existing.summedTotals[canonicalKey] = (existing.summedTotals[canonicalKey] || 0) + (data.totals[canonicalKey] || 0);
      existing.totals[canonicalKey] = (existing.totals[canonicalKey] || 0) + (data.totals[canonicalKey] || 0);
    }

    aggregated.set(playerId, existing);
  }

  // Compute per-game averages across all seasons
  const result = new Map<string, { stats: Record<CanonicalStatKey, number>; totals: Record<CanonicalStatKey, number>; gamesPlayed: number }>();
  
  for (const [playerId, data] of aggregated.entries()) {
    const stats = {} as Record<CanonicalStatKey, number>;
    for (const key in data.summedTotals) {
      const canonicalKey = key as CanonicalStatKey;
      stats[canonicalKey] = data.totalGames > 0
        ? data.summedTotals[canonicalKey] / data.totalGames
        : 0;
    }
    result.set(playerId, {
      stats,
      totals: data.totals,
      gamesPlayed: data.totalGames,
    });
  }

  return result;
}

/**
 * Check if pre-computed stats exist for a given season
 * Useful for determining if we need to run the ETL
 */
export async function hasPrecomputedStatsForSeason(
  db: typeof AdminDb,
  season: number
): Promise<{ exists: boolean; count: number }> {
  const snap = await db
    .collection('player_season_stats')
    .where('season', '==', season)
    .limit(1)
    .get();
  
  return {
    exists: !snap.empty,
    count: snap.size,
  };
}
