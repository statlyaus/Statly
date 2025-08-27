import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Legacy route disabled. Use /api/leagues/[id]/waivers/submit instead.
export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { error: 'Legacy route disabled. Use /api/leagues/[id]/waivers/submit' },
    {
      status: 410,
      headers: {
        Link: '</api/leagues/[id]/waivers/submit>; rel="alternate"',
        'Cache-Control': 'no-store',
      },
    }
  );
}
