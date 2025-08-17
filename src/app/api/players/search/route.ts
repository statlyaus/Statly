import { type NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

interface PlayerSearchResult {
  name: string;
  team: string;
  position: string;
  totalGames: number;
  averageScore: number;
  totalScore: number;
  latestRound: number;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    
    if (!query || query.length < 2) {
      return NextResponse.json({ players: [] });
    }
    
    // Get all unique players with additional stats for better search results
    const snapshot = await adminDb.collection('player_match_stats').get();
    const playersMap = new Map<string, PlayerSearchResult>();
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.player_name) {
        const playerName = data.player_name;
        if (!playersMap.has(playerName)) {
          playersMap.set(playerName, {
            name: playerName,
            team: data.team || '',
            position: data.position || '',
            totalGames: 0,
            averageScore: 0,
            totalScore: 0,
            latestRound: 0
          });
        }
        
        const player = playersMap.get(playerName);
        if (player) {
          player.totalGames++;
          player.totalScore += data.supercoach_score || 0;
          player.latestRound = Math.max(player.latestRound, data.round || 0);
          // Use most recent team/position if available
          if (data.team) player.team = data.team;
          if (data.position) player.position = data.position;
        }
      }
    });
    
    // Calculate averages and filter by search query
    const players = Array.from(playersMap.values()).map(player => ({
      ...player,
      averageScore: player.totalGames > 0 ? Math.round(player.totalScore / player.totalGames) : 0
    }));
    
    // Filter players by search query (case insensitive, search name and team)
    const filteredPlayers = players
      .filter(player => 
        player.name.toLowerCase().includes(query.toLowerCase()) ||
        player.team.toLowerCase().includes(query.toLowerCase())
      )
      .sort((a, b) => {
        // Sort by relevance: exact match first, then by average score
        const aExact = a.name.toLowerCase().startsWith(query.toLowerCase()) ? 1 : 0;
        const bExact = b.name.toLowerCase().startsWith(query.toLowerCase()) ? 1 : 0;
        
        if (aExact !== bExact) return bExact - aExact;
        return b.averageScore - a.averageScore;
      })
      .slice(0, 20); // Limit to 20 results
    
    return NextResponse.json({ players: filteredPlayers });
  } catch (error) {
    console.error('Error searching players:', error);
    return NextResponse.json(
      { error: 'Failed to search players' },
      { status: 500 }
    );
  }
}
