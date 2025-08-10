export const runtime = 'nodejs';

import { NextResponse, type NextRequest } from 'next/server';
import { getPlayers } from '@/lib/data';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search') ?? undefined;
    const team = searchParams.get('team') ?? undefined;
    const position = searchParams.get('position') ?? undefined;
    const pageParam = Number(searchParams.get('page'));
    const limitParam = Number(searchParams.get('limit'));
    const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 20;

    const players = await getPlayers({ search, team, position });
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
    return NextResponse.json(
      { message: 'Failed to fetch players' },
      { status: 500 }
    );
  }
}
