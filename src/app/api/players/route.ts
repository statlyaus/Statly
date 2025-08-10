export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { getPlayers } from '@/lib/data';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search')?.toLowerCase() ?? '';
    const team = searchParams.get('team')?.toLowerCase() ?? '';
    const position = searchParams.get('position')?.toLowerCase() ?? '';
    const pageParam = Number(searchParams.get('page'));
    const limitParam = Number(searchParams.get('limit'));
    const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 20;

    let players = await getPlayers();

    if (search) {
      players = players.filter((p) => p.name.toLowerCase().includes(search));
    }

    if (team) {
      players = players.filter((p) => p.team?.toLowerCase() === team);
    }

    if (position) {
      players = players.filter((p) => p.position?.toLowerCase() === position);
    }

    const total = players.length;
    const start = (page - 1) * limit;
    const end = start + limit;
    const pagedPlayers = players.slice(start, end);

    return NextResponse.json({
      players: pagedPlayers,
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error('API Error fetching players:', error);
    return NextResponse.json({ message: 'Failed to fetch players' }, { status: 500 });
  }
}
