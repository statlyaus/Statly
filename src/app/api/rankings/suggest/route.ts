import { NextRequest, NextResponse } from 'next/server';

interface PlayerInput {
  id: string;
}

// Stub AI ranking suggestion endpoint
export async function POST(req: NextRequest) {
  const { players = [] } = (await req.json()) as { players: PlayerInput[] };
  // Return top 5 players from provided list as suggestions
  const suggestions = Array.isArray(players)
    ? players.slice(0, 5).map(p => ({ playerId: p.id }))
    : [];
  return NextResponse.json({ suggestions });
}
