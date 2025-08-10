export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getPlayers } from '@/lib/data';

export async function GET() {
  try {
    const players = await getPlayers();
    return NextResponse.json(players);
  } catch (error) {
    console.error('API Error fetching players:', error);
    return NextResponse.json(
      { message: 'Failed to fetch players' },
      { status: 500 }
    );
  }
}