import { type NextRequest, NextResponse } from 'next/server';

import { commonErrors } from '@/lib/apiResponse';
import { getDefaultAflSeason } from '@/lib/aflSeason';
import { adminDb } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { readCanonicalPlayerId } from '@/lib/playerMatchStats';
import { getPlayerPosition } from '@/lib/playerPositionMapping';

export const runtime = 'nodejs';
const CACHE_SECONDS = 300; // 5 minutes cache

// 9 Categories for Rankings
export type RankingCategory =
  | 'goals'
  | 'goal_assists'
  | 'tackles'
  | 'clearances'
  | 'inside_50s'
  | 'rebound_50s'
  | 'hitouts'
  | 'intercepts'
  | 'marks';

// Player ownership status
export type OwnershipStatus = 'OWNED' | 'AVAILABLE' | 'WAIVER';

export interface PlayerRanking {
  playerId: string;
  playerName: string;
  team: string;
  position: string;
  games: number;
  ownership: OwnershipStatus;
  overall: number; // Z-score sum
  rank: number;
  categories: Record<
    RankingCategory,
    {
      perGame: number;
      zScore: number;
    }
  >;
}

export interface RankingsResponse {
  players: PlayerRanking[];
  meta: {
    period: string;
    position?: string;
    ownership?: string;
    sortBy: string;
    totalPlayers: number;
    averages: Record<RankingCategory, number>;
    stdDevs: Record<RankingCategory, number>;
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

function readNumber(
  data: FirebaseFirestore.DocumentData,
  key: string,
  fallbackKeys: string[] = []
): number {
  const stats = (data.stats as Record<string, unknown> | undefined) ?? {};
  const raw = (data.raw_row as Record<string, unknown> | undefined) ?? {};

  for (const candidate of [key, ...fallbackKeys]) {
    const value = data[candidate] ?? stats[candidate] ?? raw[candidate];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return 0;
}

// Get ownership status for a player in a league (mock implementation for now)
async function getOwnershipStatus(_playerId: string, _leagueId?: string): Promise<OwnershipStatus> {
  // TODO: Implement actual ownership lookup from Firestore
  // For now, return AVAILABLE for all players
  return 'AVAILABLE';
}

export async function GET(request: NextRequest) {
  try {
    const db = adminDb;
    const { searchParams } = new URL(request.url);

    // Query parameters
    const season = parseInt(searchParams.get('season') || String(getDefaultAflSeason()), 10);
    const period = searchParams.get('period') || 'season'; // season, last3, last5, last10, round={n}, since={date}
    const position = searchParams.get('position'); // ALL, DEF, MID, RUC, FWD
    const ownership = searchParams.get('ownership'); // owned, available, waiver
    const leagueId = searchParams.get('leagueId');
    const sortBy = searchParams.get('sortBy') || 'overall'; // overall or category name
    const sortDirection = searchParams.get('sortDirection') || 'desc'; // asc or desc
    const limit = parseInt(searchParams.get('limit') || '0'); // 0 means no limit
    const search = searchParams.get('search');

    logger.debug('Rankings API query', {
      season,
      period,
      position,
      ownership,
      sortBy,
      sortDirection,
    });

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
    logger.debug('Found player match records', {
      recordCount: snapshot.docs.length,
      season,
      period,
    });

    // Aggregate data by player
    const playerAggregates = new Map<
      string,
      {
        playerName: string;
        team: string;
        position: string;
        games: number;
        stats: Record<RankingCategory, number>;
      }
    >();

    snapshot.docs.forEach((doc) => {
      const data = doc.data() as FirebaseFirestore.DocumentData;
      const playerId = readCanonicalPlayerId(data);
      const playerName = typeof data.player_name === 'string' ? data.player_name.trim() : '';

      if (!playerId || !playerName || playerName.includes('____')) {
        logger.warn('Skipping document with invalid canonical player data', {
          docId: doc.id,
          playerId,
          playerName,
        });
        return;
      }

      // Extract the 9 categories with improved data handling
      const goals = readNumber(data, 'goals');
      const goal_assists =
        readNumber(data, 'goal_assists', ['goalAssists']) ||
        readNumber(data, 'score_involvements', ['scoreInvolvements']);
      const tackles = readNumber(data, 'tackles');
      const clearances =
        readNumber(data, 'clearances') ||
        // Use contested_possessions as a substitute if clearances not available
        readNumber(data, 'contested_possessions', ['contestedPossessions']) * 0.3 ||
        0;
      const inside_50s = readNumber(data, 'inside_50s', ['inside50s']);
      const rebound_50s = readNumber(data, 'rebound_50s', ['rebound50s']);
      const hitouts = readNumber(data, 'hitouts', ['hit_outs']);
      const intercepts = readNumber(data, 'intercepts');
      const marks = readNumber(data, 'marks');
      const playerKey = playerId;

      if (playerAggregates.has(playerKey)) {
        const existing = playerAggregates.get(playerKey)!;
        existing.games += 1;
        existing.stats.goals += goals;
        existing.stats.goal_assists += goal_assists;
        existing.stats.tackles += tackles;
        existing.stats.clearances += clearances;
        existing.stats.inside_50s += inside_50s;
        existing.stats.rebound_50s += rebound_50s;
        existing.stats.hitouts += hitouts;
        existing.stats.intercepts += intercepts;
        existing.stats.marks += marks;
      } else {
        playerAggregates.set(playerKey, {
          playerName,
          team: typeof data.team === 'string' ? data.team : 'Unknown',
          position:
            typeof data.position === 'string' && data.position.trim().length > 0
              ? data.position
              : getPlayerPosition(playerName),
          games: 1,
          stats: {
            goals,
            goal_assists,
            tackles,
            clearances,
            inside_50s,
            rebound_50s,
            hitouts,
            intercepts,
            marks,
          },
        });
      }
    });

    // Filter by period (last N games)
    let filteredPlayers = Array.from(playerAggregates.entries()).map(([playerKey, data]) => ({
      playerId: playerKey,
      ...data,
      perGameStats: {
        goals: data.stats.goals / data.games,
        goal_assists: data.stats.goal_assists / data.games,
        tackles: data.stats.tackles / data.games,
        clearances: data.stats.clearances / data.games,
        inside_50s: data.stats.inside_50s / data.games,
        rebound_50s: data.stats.rebound_50s / data.games,
        hitouts: data.stats.hitouts / data.games,
        intercepts: data.stats.intercepts / data.games,
        marks: data.stats.marks / data.games,
      },
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

    // Calculate league averages for each category
    const categories: RankingCategory[] = [
      'goals',
      'goal_assists',
      'tackles',
      'clearances',
      'inside_50s',
      'rebound_50s',
      'hitouts',
      'intercepts',
      'marks',
    ];
    const leagueAverages: Record<RankingCategory, number> = {} as Record<RankingCategory, number>;
    const stdDevs: Record<RankingCategory, number> = {} as Record<RankingCategory, number>;

    categories.forEach((cat) => {
      const values = filteredPlayers.map((p) => p.perGameStats[cat]);
      leagueAverages[cat] = values.reduce((sum, val) => sum + val, 0) / values.length;

      const variance =
        values.reduce((sum, val) => sum + Math.pow(val - leagueAverages[cat], 2), 0) /
        values.length;
      stdDevs[cat] = Math.sqrt(variance) || 0.01; // Prevent division by zero
    });

    // Apply shrinkage and calculate Z-scores
    const rankedPlayers: Omit<PlayerRanking, 'rank'>[] = await Promise.all(
      filteredPlayers.map(async (player) => {
        const categoryScores: Record<RankingCategory, { perGame: number; zScore: number }> =
          {} as Record<RankingCategory, { perGame: number; zScore: number }>;
        let overallScore = 0;
        (
          [
            'goals',
            'goal_assists',
            'tackles',
            'clearances',
            'inside_50s',
            'rebound_50s',
            'hitouts',
            'intercepts',
            'marks',
          ] as RankingCategory[]
        ).forEach((cat) => {
          // Apply shrinkage to handle small sample sizes
          const adjustedRate = shrinkToLeagueAverage(
            player.perGameStats[cat],
            player.games,
            leagueAverages[cat],
            3
          );

          // Calculate Z-score
          const zScore = calculateZScore(adjustedRate, leagueAverages[cat], stdDevs[cat]);

          categoryScores[cat] = {
            perGame: adjustedRate,
            zScore,
          };

          overallScore += zScore;
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
      finalPlayers.sort((a, b) =>
        sortDirection === 'asc'
          ? a.categories[cat].zScore - b.categories[cat].zScore
          : b.categories[cat].zScore - a.categories[cat].zScore
      );
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

    return NextResponse.json(
      {
        success: true,
        data: response,
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          'Cache-Control': `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`,
        },
      }
    );
  } catch (error) {
    logger.error('Rankings API error', error instanceof Error ? error : new Error(String(error)));
    return commonErrors.internalServerError('Failed to fetch rankings', {
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
