import 'server-only';

import { adminDb, firebaseAdminIsDisabled } from '@/lib/firebaseAdmin';
import { getPlayerPosition } from '@/lib/playerPositionMapping';
import { normalizeCategoryDirections } from '@/server/leagues/categoryDirections';
import type { CategoryDirection } from '@/server/leagues/scoringTypes';
import { REAL_DATA_NINE_CATEGORY_PRESET } from '@/types/fantasyCategories';

/** The nine real-data league categories (the league default preset). */
export type RankingCategory = (typeof REAL_DATA_NINE_CATEGORY_PRESET)[number];

const RANKING_CATEGORIES: readonly RankingCategory[] = REAL_DATA_NINE_CATEGORY_PRESET;

/**
 * Each category's key under `stats` in a `player_match_stats` document (written by
 * etl/processFootywireData.ts with the keys of etl/normalizePlayerRow.ts).
 * Only this key is read: a stat the document does not report is missing, never estimated.
 */
export const RANKING_ETL_KEY: Record<RankingCategory, string> = {
  goals: 'goals',
  tackles: 'tackles',
  inside50s: 'inside_50s',
  intercepts: 'intercepts',
  contestedMarks: 'contested_marks',
  rebound50s: 'rebound_50s',
  contestedPossessions: 'contested_possessions',
  effectiveDisposals: 'effective_disposals',
  scoreInvolvements: 'score_involvements',
};

// Player ownership status
export type OwnershipStatus = 'OWNED' | 'AVAILABLE' | 'WAIVER';

/** A category the player never reported is null in both fields. */
export interface CategoryRanking {
  /** The real per-game average over the games that reported the stat. */
  perGame: number | null;
  /** Sample-size adjusted strength; negated for a LOW_WINS category. */
  zScore: number | null;
}

export interface PlayerRanking {
  playerId: string;
  playerName: string;
  team: string;
  position: string;
  games: number;
  ownership: OwnershipStatus;
  /** Sum of the reported categories' z-scores. */
  overall: number;
  rank: number;
  categories: Record<RankingCategory, CategoryRanking>;
}

export interface RankingsResponse {
  players: PlayerRanking[];
  meta: {
    period: string;
    position?: string;
    ownership?: string;
    sortBy: string;
    totalPlayers: number;
    /** Null for a category no ranked player reported. */
    averages: Record<RankingCategory, number | null>;
    stdDevs: Record<RankingCategory, number | null>;
  };
}

// Shrinkage function to handle small sample sizes
function shrinkToLeagueAverage(observed: number, games: number, leagueAvg: number, k = 3): number {
  const weight = games / (games + k);
  return weight * observed + (1 - weight) * leagueAvg;
}

// Calculate Z-score
function calculateZScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0;
  return (value - mean) / stdDev;
}

function perCategory<T>(value: (category: RankingCategory) => T): Record<RankingCategory, T> {
  return Object.fromEntries(
    RANKING_CATEGORIES.map((category) => [category, value(category)])
  ) as Record<RankingCategory, T>;
}

const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

// Get ownership status for a player in a league (mock implementation for now)
async function getOwnershipStatus(_playerId: string, _leagueId?: string): Promise<OwnershipStatus> {
  // TODO: Implement actual ownership lookup from Firestore
  // For now, return AVAILABLE for all players
  return 'AVAILABLE';
}

export interface RankingsOptions {
  season: number;
  /** season, last3, last5, last10, round={n}, since={date} */
  period?: string;
  /** ALL, DEF, MID, RUC, FWD */
  position?: string | null;
  /** owned, available, waiver */
  ownership?: string | null;
  leagueId?: string | null;
  /** overall, name or a category */
  sortBy?: string;
  sortDirection?: string;
  /** 0 means no limit */
  limit?: number;
  search?: string | null;
  /** Defaults to HIGH_WINS for every category; LOW_WINS negates that category's z-score. */
  categoryDirections?: Partial<Record<RankingCategory, CategoryDirection>>;
}

/** Nine-category z-score rankings from player_match_stats. Shared by the API route and the page. */
export async function getCategoryRankings({
  season,
  period = 'season',
  position = null,
  ownership = null,
  leagueId = null,
  sortBy = 'overall',
  sortDirection = 'desc',
  limit = 0,
  search = null,
  categoryDirections,
}: RankingsOptions): Promise<RankingsResponse> {
  if (firebaseAdminIsDisabled()) {
    const emptyCategoryValues = perCategory<number | null>(() => null);

    return {
      players: [],
      meta: {
        period,
        position: position || undefined,
        ownership: ownership || undefined,
        sortBy,
        totalPlayers: 0,
        averages: emptyCategoryValues,
        stdDevs: emptyCategoryValues,
      },
    };
  }

  const db = adminDb;
  const directions = normalizeCategoryDirections(RANKING_CATEGORIES, categoryDirections);

  console.log(
    `[Rankings API] Querying for season=${season}, period=${period}, position=${position}, ownership=${ownership}`
  );

  // Build base query for player_match_stats
  let query = db.collection('player_match_stats').where('season', '==', season);

  // Apply period filters
  if (period.startsWith('round=')) {
    const roundNum = parseInt(period.split('=')[1]);
    query = query.where('round', '==', roundNum);
  } else if (period.startsWith('since=')) {
    const sinceDate = new Date(period.split('=')[1]);
    query = query.where('last_updated', '>=', sinceDate);
  }

  // Get all matching documents
  const snapshot = await query.get();
  console.log(`[Rankings API] Found ${snapshot.docs.length} player match records`);

  // Aggregate data by player: per category, the total and the games that reported it.
  const playerAggregates = new Map<
    string,
    {
      playerName: string;
      team: string;
      position: string;
      games: number;
      totals: Record<RankingCategory, number>;
      gamesReported: Record<RankingCategory, number>;
    }
  >();

  snapshot.docs.forEach((doc) => {
    const data = doc.data() as FirebaseFirestore.DocumentData;
    let playerName = data.player_name;

    // If player_name is missing or empty, try to extract from different locations
    if (!playerName || playerName.trim() === '') {
      // Try extracting from the end of the document if it's stored there
      if (data.player_name) {
        playerName = data.player_name;
      } else {
        // Try to extract from document ID if it follows the pattern
        const docId = doc.id;
        if (docId.includes('_2025_')) {
          const parts = docId.split('_2025_')[0];
          playerName = parts.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
        }
      }
    }

    // Skip if we still don't have a valid player name
    if (!playerName || playerName.trim() === '' || playerName.includes('____')) {
      console.warn(`Skipping document with invalid player name: ${doc.id}, name: '${playerName}'`);
      return;
    }

    // The ETL writes the stats under `stats`; a document without them is not a counted game.
    const stats: unknown = data.stats;
    if (!stats || typeof stats !== 'object') {
      console.warn(`Skipping player_match_stats/${doc.id}: no stats object`);
      return;
    }
    const statValues = stats as Record<string, unknown>;

    // Clean up player name
    playerName = playerName.trim();

    // Use a combination of player name and team as the key to handle duplicates better
    const playerKey = `${playerName}_${data.team || 'Unknown'}`;

    const aggregate = playerAggregates.get(playerKey) ?? {
      playerName,
      team: data.team || 'Unknown',
      position: getPlayerPosition(playerName), // Use smart position mapping
      games: 0,
      totals: perCategory(() => 0),
      gamesReported: perCategory(() => 0),
    };
    aggregate.games += 1;
    for (const category of RANKING_CATEGORIES) {
      const value = finiteOrNull(statValues[RANKING_ETL_KEY[category]]);
      if (value === null) continue;
      aggregate.totals[category] += value;
      aggregate.gamesReported[category] += 1;
    }
    playerAggregates.set(playerKey, aggregate);
  });

  // A player who reported none of the nine categories has nothing to rank.
  let filteredPlayers = Array.from(playerAggregates.entries())
    .filter(([, data]) => RANKING_CATEGORIES.some((category) => data.gamesReported[category] > 0))
    .map(([playerKey, data]) => ({
      playerId: playerKey, // Use the combined key as ID
      ...data,
      perGameStats: perCategory((category) =>
        data.gamesReported[category] > 0
          ? data.totals[category] / data.gamesReported[category]
          : null
      ),
    }));

  // Apply last N games filter if needed
  if (period.startsWith('last')) {
    const lastN = parseInt(period.substring(4));
    filteredPlayers = filteredPlayers.filter((p) => p.games >= Math.min(lastN, 3)); // Minimum sample size
  }

  // Filter by position
  if (position && position !== 'ALL') {
    filteredPlayers = filteredPlayers.filter((p) => p.position === position);
  }

  // League average and spread per category, over the players who reported it.
  const categories = RANKING_CATEGORIES;
  const leagueAverages = perCategory<number | null>(() => null);
  const stdDevs = perCategory<number | null>(() => null);

  categories.forEach((cat) => {
    const values = filteredPlayers
      .map((p) => p.perGameStats[cat])
      .filter((value): value is number => value !== null);
    if (values.length === 0) return;
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    leagueAverages[cat] = mean;
    stdDevs[cat] = Math.sqrt(variance);
  });

  // Apply shrinkage and calculate Z-scores
  const rankedPlayers: Omit<PlayerRanking, 'rank'>[] = await Promise.all(
    filteredPlayers.map(async (player) => {
      let overallScore = 0;
      const categoryScores = perCategory<CategoryRanking>((cat) => {
        const perGame = player.perGameStats[cat];
        const mean = leagueAverages[cat];
        const stdDev = stdDevs[cat];
        if (perGame === null || mean === null || stdDev === null) {
          return { perGame: null, zScore: null };
        }

        // Shrink toward the league average for the z-score only; the shown figure stays real.
        const adjustedRate = shrinkToLeagueAverage(perGame, player.gamesReported[cat], mean, 3);
        const sign = directions[cat] === 'LOW_WINS' ? -1 : 1;
        const zScore = sign * calculateZScore(adjustedRate, mean, stdDev);

        overallScore += zScore;
        return { perGame, zScore };
      });

      const ownership = await getOwnershipStatus(player.playerId, leagueId || undefined);

      return {
        playerId: player.playerId,
        playerName: player.playerName,
        team: player.team,
        position: player.position,
        games: player.games,
        ownership,
        overall: overallScore,
        categories: categoryScores,
      };
    })
  );

  // Apply ownership filter
  let finalPlayers = rankedPlayers;
  if (ownership) {
    finalPlayers = rankedPlayers.filter((p) => {
      switch (ownership.toLowerCase()) {
        case 'owned':
          return p.ownership === 'OWNED';
        case 'available':
          return p.ownership === 'AVAILABLE';
        case 'waiver':
          return p.ownership === 'WAIVER';
        default:
          return true;
      }
    });
  }

  // Apply search filter
  if (search) {
    finalPlayers = finalPlayers.filter(
      (p) =>
        p.playerName.toLowerCase().includes(search.toLowerCase()) ||
        p.team.toLowerCase().includes(search.toLowerCase())
    );
  }

  // Sort by requested field
  if (sortBy === 'overall') {
    finalPlayers.sort((a, b) =>
      sortDirection === 'asc' ? a.overall - b.overall : b.overall - a.overall
    );
  } else if (sortBy === 'name') {
    finalPlayers.sort((a, b) =>
      sortDirection === 'asc'
        ? a.playerName.localeCompare(b.playerName)
        : b.playerName.localeCompare(a.playerName)
    );
  } else if (categories.includes(sortBy as RankingCategory)) {
    const cat = sortBy as RankingCategory;
    // A player missing the category sorts last whichever way the column is sorted.
    finalPlayers.sort((a, b) => {
      const za = a.categories[cat].zScore;
      const zb = b.categories[cat].zScore;
      if (za === null || zb === null) return za === zb ? 0 : za === null ? 1 : -1;
      return sortDirection === 'asc' ? za - zb : zb - za;
    });
  }

  // Assign ranks
  const playersWithRanks: PlayerRanking[] = finalPlayers.map((player, index) => ({
    ...player,
    rank: index + 1,
  }));

  // Apply limit only if specified
  const limitedPlayers = limit > 0 ? playersWithRanks.slice(0, limit) : playersWithRanks;

  const response: RankingsResponse = {
    players: limitedPlayers,
    meta: {
      period,
      position: position || undefined,
      ownership: ownership || undefined,
      sortBy,
      totalPlayers: finalPlayers.length,
      averages: leagueAverages,
      stdDevs,
    },
  };

  return response;
}
