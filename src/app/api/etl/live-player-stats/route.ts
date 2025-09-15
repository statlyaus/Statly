import { NextResponse, type NextRequest } from 'next/server';
export const runtime = 'nodejs';

import { getLivePlayerStats, getLivePlayerStatsPaged } from '@/lib/etlIntegration';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get('limit');
  const cursor = searchParams.get('cursor');
  const seasonParam = searchParams.get('season');

  const limit = limitParam ? Math.max(1, Math.min(parseInt(limitParam, 10) || 50, 500)) : null;
  const season = seasonParam ? parseInt(seasonParam, 10) : undefined;

  if (limit) {
    const { items, nextCursor } = await getLivePlayerStatsPaged({ season, limit, cursor });
    const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
    if (nextCursor) headers['Link'] = `<${request.nextUrl.pathname}?limit=${limit}&cursor=${encodeURIComponent(nextCursor)}>; rel="next"`;
    return NextResponse.json({ data: items, nextCursor }, { headers });
  }

  const data = await getLivePlayerStats(season);
  return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
}
