import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';

interface FirebasePlayer {
  id?: string;
  name?: string;
  position?: string;
  team?: string;
  averageScore?: number;
  lastGameScore?: number;
  projectedScore?: number;
  form?: number[];
  injuryStatus?: string;
  priceChange?: number;
  ownership?: number;
  pickNumber?: number;
  round?: number;
  captain?: boolean;
  viceCaptain?: boolean;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { leagueId: string; userId: string } }
) {
  try {
    const { leagueId, userId } = params;
    
    if (!leagueId || !userId) {
      return NextResponse.json(
        { error: 'League ID and User ID are required' },
        { status: 400 }
      );
    }

    // Get the user's roster from Firebase
    const rosterRef = adminDb
      .collection('leagues')
      .doc(leagueId)
      .collection('rosters')
      .doc(userId);

    const rosterDoc = await rosterRef.get();

    if (!rosterDoc.exists) {
      return NextResponse.json(
        { error: 'Roster not found for this user in this league' },
        { status: 404 }
      );
    }

    const rosterData = rosterDoc.data();
    
    if (!rosterData?.players) {
      return NextResponse.json(
        { error: 'No players found in roster' },
        { status: 404 }
      );
    }

    // Transform Firebase roster data to match expected format
    const formattedPlayers = rosterData.players.map((player: FirebasePlayer, index: number) => ({
      id: player.id || `player-${index}`,
      name: player.name || 'Unknown Player',
      position: player.position || 'Unknown',
      team: player.team || 'AFL',
      averageScore: player.averageScore || 75,
      lastGameScore: player.lastGameScore || 0,
      projectedScore: player.projectedScore || 80,
      form: player.form || [70, 75, 80, 85, 90],
      injuryStatus: player.injuryStatus || 'healthy',
      priceChange: player.priceChange || 0,
      ownership: player.ownership || 15,
      captain: player.captain || false,
      viceCaptain: player.viceCaptain || false
    }));

    return NextResponse.json({
      leagueId,
      userId,
      players: formattedPlayers,
      totalPlayers: formattedPlayers.length,
      lastUpdated: rosterData.lastUpdated || new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error fetching league roster:', error);
    return NextResponse.json(
      { error: 'Failed to fetch league roster' },
      { status: 500 }
    );
  }
}
