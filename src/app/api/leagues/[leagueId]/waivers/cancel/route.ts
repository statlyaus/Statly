import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Legacy route disabled. Use /api/leagues/[id]/waivers/cancel instead.
export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { error: 'Legacy route disabled. Use /api/leagues/[id]/waivers/cancel' },
    {
      status: 410,
      headers: {
        Link: '</api/leagues/[id]/waivers/cancel>; rel="alternate"',
        'Cache-Control': 'no-store, max-age=0, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    }
  );
}
