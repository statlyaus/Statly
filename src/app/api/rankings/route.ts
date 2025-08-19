import { type NextRequest, NextResponse } from 'next/server';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin (server-side only)
if (!getApps().length) {
  try {
    let serviceAccount;

    if (process.env.GOOGLE_SERVICE_ACCOUNT) {
      serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64) {
      const decodedJson = Buffer.from(
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64,
        'base64'
      ).toString('utf-8');
      serviceAccount = JSON.parse(decodedJson);
    } else {
      throw new Error('No Firebase service account found in environment variables');
    }

    initializeApp({
      credential: cert(serviceAccount),
    });
  } catch (error) {
    console.error('Failed to initialize Firebase Admin:', error);
  }
}

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

// Get ownership status for a player in a league (mock implementation for now)
async function getOwnershipStatus(_playerId: string, _leagueId?: string): Promise<OwnershipStatus> {
  // TODO: Implement actual ownership lookup from Firestore
  // For now, return AVAILABLE for all players
  return 'AVAILABLE';
}

export async function GET(request: NextRequest) {
  try {
    const db = getFirestore();
    const { searchParams } = new URL(request.url);

    // Query parameters
    const season = parseInt(searchParams.get('season') || '2025');
    const period = searchParams.get('period') || 'season'; // season, last3, last5, last10, round={n}, since={date}
    const position = searchParams.get('position'); // ALL, DEF, MID, RUC, FWD
    const ownership = searchParams.get('ownership'); // owned, available, waiver
    const leagueId = searchParams.get('leagueId');
    const sortBy = searchParams.get('sortBy') || 'overall'; // overall or category name
    const sortDirection = searchParams.get('sortDirection') || 'desc'; // asc or desc
    const limit = parseInt(searchParams.get('limit') || '0'); // 0 means no limit
    const search = searchParams.get('search');

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
      const data = doc.data();
      // Handle different player name sources
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
            playerName = parts.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          }
        }
      }

      // Skip if we still don't have a valid player name
      if (!playerName || playerName.trim() === '' || playerName.includes('____')) {
        console.warn(`Skipping document with invalid player name: ${doc.id}, name: '${playerName}'`);
        return;
      }

      // Clean up player name
      playerName = playerName.trim();

      // Extract the 9 categories with improved data handling
      const goals = data.goals || data.stats?.goals || data.raw_row?.goals || 0;
      const goal_assists = data.goal_assists || 
        data.stats?.goal_assists ||
        data.stats?.score_involvements ||
        data.raw_row?.score_involvements ||
        data.score_involvements ||
        0;
      const tackles = data.tackles || data.stats?.tackles || data.raw_row?.tackles || 0;
      const clearances = data.clearances ||
        data.stats?.clearances || 
        data.raw_row?.clearances ||
        // Use contested_possessions as a substitute if clearances not available
        (data.contested_possessions || data.stats?.contested_possessions || data.raw_row?.contested_possessions || 0) * 0.3 ||
        0;
      const inside_50s = data.inside_50s || data.stats?.inside_50s || data.raw_row?.inside_50s || 0;
      const rebound_50s = data.rebound_50s || data.stats?.rebound_50s || data.raw_row?.rebound_50s || 0;
      const hitouts = data.hitouts || data.stats?.hit_outs || data.stats?.hitouts || data.raw_row?.hitouts || 0;
      const intercepts = data.intercepts || data.stats?.intercepts || data.raw_row?.intercepts || 0;
      const marks = data.marks || data.stats?.marks || data.raw_row?.marks || 0;

      // Use a combination of player name and team as the key to handle duplicates better
      const playerKey = `${playerName}_${data.team || 'Unknown'}`;
      
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
          team: data.team || 'Unknown',
          position: data.position || 'MID',
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
      playerId: playerKey, // Use the combined key as ID
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
    console.error('[Rankings API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch rankings',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
