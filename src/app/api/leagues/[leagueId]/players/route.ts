import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Legacy route permanently moved to /api/leagues/[id]/players
export async function GET(req: Request) {
  const url = new URL('/api/leagues/[id]/players', req.url);
  return NextResponse.redirect(url, 308);
}
