import { NextResponse } from 'next/server';
export const runtime = 'nodejs';

import { getDataFreshness } from '@/lib/etlIntegration';

export async function GET() {
  const data = await getDataFreshness();
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
