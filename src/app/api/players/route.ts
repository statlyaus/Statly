import { NextResponse } from 'next/server';
import { mockAvailablePlayers, myTeam } from '@/mockData';
import type { Player } from '@/types';

export async function GET() {
  // In a real app, you'd fetch this from a database or external API
  const allPlayers: Player[] = [...myTeam, ...mockAvailablePlayers];

  // Sort by average points descending
  allPlayers.sort((a, b) => (b.avg || 0) - (a.avg || 0));

  return NextResponse.json(allPlayers);
}