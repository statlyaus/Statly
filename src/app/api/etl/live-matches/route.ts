import { NextResponse } from 'next/server';
export const runtime = 'nodejs';

import { getLiveMatches } from '@/lib/etlIntegration';

export async function GET() {
  const data = await getLiveMatches();
  return NextResponse.json(
    { data },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
