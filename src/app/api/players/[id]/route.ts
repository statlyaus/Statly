export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { getPlayer } from '@/lib/data';

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const player = await getPlayer(params.id);
    if (!player) {
      return NextResponse.json({ message: 'Player not found' }, { status: 404 });
    }
    return NextResponse.json(player);
  } catch (error) {
    console.error('API Error fetching player:', error);
    return NextResponse.json({ message: 'Failed to fetch player' }, { status: 500 });
  }
}
