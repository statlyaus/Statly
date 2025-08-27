import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Legacy route disabled. Use /api/leagues/[id]/waivers/process instead.
export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { error: 'Legacy route disabled. Use /api/leagues/[id]/waivers/process' },
    {
      status: 410,
      headers: {
        Link: '</api/leagues/[id]/waivers/process>; rel="alternate"',
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
        Expires: '0',
      },
    }
  );
}
