import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';

// Stub AI ranking suggestion endpoint
export async function POST(req: NextRequest) {
  const { players = [] } = (await req.json()) as { players: { id: string }[] };
  // Return top 5 players from provided list as suggestions
  const suggestions = Array.isArray(players)
    ? players.slice(0, 5).map((p) => ({ playerId: p.id }))
    : [];
  return NextResponse.json({ suggestions });
}
