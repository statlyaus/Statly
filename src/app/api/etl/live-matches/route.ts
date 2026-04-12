import { NextResponse } from 'next/server';
export const runtime = 'nodejs';

import { getLiveMatches } from '@/lib/etlIntegration';
import { refreshLiveStatsIfNeeded } from '@/lib/liveStatsRefresh';

export async function GET() {
  await refreshLiveStatsIfNeeded({
    minIntervalMs: 30_000,
    trigger: 'etl-live-matches',
  }).catch(() => undefined);

  const data = await getLiveMatches();
  return NextResponse.json(
    { data },
    { headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' } }
  );
}
