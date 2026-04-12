import { NextResponse } from 'next/server';
export const runtime = 'nodejs';

import { getPlayerProfilesMap } from '@/lib/etlIntegration';

export async function GET() {
  const data = await getPlayerProfilesMap();
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' },
  });
}
