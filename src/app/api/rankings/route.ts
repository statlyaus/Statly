import { type NextRequest, NextResponse } from 'next/server';
import { getPlayerPosition } from '@/lib/playerPositionMapping';
import { adminDb, firebaseAdminIsDisabled } from '@/lib/firebaseAdmin';
import {
  RANKING_CATEGORIES,
  type CategoryScore,
  type CategoryTotals,
  type RankingCategory,
  addCategoryStats,
  emptyCategoryTotals,
  readCategoryStats,
  parseSeason,
  scoreCategories,
} from '@/lib/rankings/categoryRankings';

export const runtime = 'nodejs';
const CACHE_SECONDS = 300; // 5 minutes cache

export type { RankingCategory };

export interface PlayerRanking {
  playerId: string;
  playerName: string;
  team: string;
  position: string;
  games: number;
  overall: number; // Z-score sum over the categories the player has data for
  rank: number;
  categories: Record<RankingCategory, CategoryScore>;
}

export interface RankingsResponse {
  players: PlayerRanking[];
  meta: {
    season: number | null;
    period: string;
    position?: string;
    sortBy: string;
    totalPlayers: number;
    averages: Record<RankingCategory, number | null>;
    stdDevs: Record<RankingCategory, number | null>;
  };
}

async function latestSeasonWithData(): Promise<number | null> {
  const snapshot = await adminDb
    .collection('player_match_stats')
    .orderBy('season', 'desc')
    .limit(1)
    .get();
  const season = snapshot.docs[0]?.data().season;
  return typeof season === 'number' ? season : null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Query parameters
    const period = searchParams.get('period') || 'season'; // season, last3, last5, last10, round={n}, since={date}
    const position = searchParams.get('position'); // ALL, DEF, MID, RUC, FWD
    const sortBy = searchParams.get('sortBy') || 'overall'; // overall or category name
    const sortDirection = searchParams.get('sortDirection') || 'desc'; // asc or desc
    const limit = parseInt(searchParams.get('limit') || '0'); // 0 means no limit
    const search = searchParams.get('search');

    const emptyResponse = (season: number | null) => {
      const emptyCategoryValues = Object.fromEntries(
        RANKING_CATEGORIES.map((category) => [category, null])
      ) as Record<RankingCategory, number | null>;
      const data: RankingsResponse = {
        players: [],
        meta: {
          season,
          period,
          position: position || undefined,
          sortBy,
          totalPlayers: 0,
          averages: emptyCategoryValues,
          stdDevs: emptyCategoryValues,
        },
      };
      return NextResponse.json({ success: true, data, timestamp: new Date().toISOString() });
    };

    if (firebaseAdminIsDisabled()) {
      return emptyResponse(null);
    }

    // Without a requested season, default to the latest season with data
    const season = parseSeason(searchParams.get('season')) ?? (await latestSeasonWithData());
    if (season === null) {
      return emptyResponse(null);
    }

    const db = adminDb;

    console.log(
      `[Rankings API] Querying for season=${season}, period=${period}, position=${position}`
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
        categoryTotals: CategoryTotals;
      }
    >();

    snapshot.docs.forEach((doc) => {
      const data = doc.data() as FirebaseFirestore.DocumentData;
      let playerName = data.player_name;

      // If player_name is missing or empty, try to extract it from the document ID
      if (!playerName || playerName.trim() === '') {
        const seasonMarker = `_${season}_`;
        if (doc.id.includes(seasonMarker)) {
          const parts = doc.id.split(seasonMarker)[0];
          playerName = parts.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
        }
      }

      // Skip if we still don't have a valid player name
      if (!playerName || playerName.trim() === '' || playerName.includes('____')) {
        console.warn(
          `Skipping document with invalid player name: ${doc.id}, name: '${playerName}'`
        );
        return;
      }

      // Clean up player name
      playerName = playerName.trim();

      // Use a combination of player name and team as the key to handle duplicates better
      const playerKey = `${playerName}_${data.team || 'Unknown'}`;

      let aggregate = playerAggregates.get(playerKey);
      if (!aggregate) {
        aggregate = {
          playerName,
          team: data.team || 'Unknown',
          position: getPlayerPosition(playerName), // Use smart position mapping
          games: 0,
          categoryTotals: emptyCategoryTotals(),
        };
        playerAggregates.set(playerKey, aggregate);
      }
      aggregate.games += 1;
      addCategoryStats(aggregate.categoryTotals, readCategoryStats(data));
    });

    let filteredPlayers = Array.from(playerAggregates.entries()).map(([playerKey, data]) => ({
      playerId: playerKey, // Use the combined key as ID
      ...data,
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

    const scored = scoreCategories(filteredPlayers);

    let finalPlayers: Omit<PlayerRanking, 'rank'>[] = scored.players.map((player) => ({
      playerId: player.playerId,
      playerName: player.playerName,
      team: player.team,
      position: player.position,
      games: player.games,
      overall: player.overall,
      categories: player.categories,
    }));

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
    } else if ((RANKING_CATEGORIES as readonly string[]).includes(sortBy)) {
      const cat = sortBy as RankingCategory;
      // Players without data for the category sort last either way
      const missingLast = sortDirection === 'asc' ? Infinity : -Infinity;
      const z = (p: Omit<PlayerRanking, 'rank'>) => p.categories[cat].zScore ?? missingLast;
      finalPlayers.sort((a, b) => (sortDirection === 'asc' ? z(a) - z(b) : z(b) - z(a)));
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
        season,
        period,
        position: position || undefined,
        sortBy,
        totalPlayers: finalPlayers.length,
        averages: scored.averages,
        stdDevs: scored.stdDevs,
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
