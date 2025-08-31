import { NextRequest, NextResponse } from 'next/server';

// Stub AI ranking suggestion endpoint
export async function POST(req: NextRequest) {
  const { players = [] } = await req.json();
  // Return top 5 players from provided list as suggestions
  const suggestions = Array.isArray(players)
    ? players.slice(0, 5).map((p: any) => ({ playerId: p.id }))
    : [];
  return NextResponse.json({ suggestions });
}
