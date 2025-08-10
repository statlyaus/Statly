export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getPlayers } from '@/lib/data';
import type { Player } from '@/types/players';

export async function GET() {
  try {
    const players = await getPlayers();
    const playersWithInjury: Player[] = players.map((p) => ({
      ...p,
      injury: p.injury,
    }));
    return NextResponse.json(playersWithInjury);
  } catch (error) {
    console.error('API Error fetching players:', error);
    return NextResponse.json(
      { message: 'Failed to fetch players' },
      { status: 500 }
    );
  }
}