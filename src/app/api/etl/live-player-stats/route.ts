import { NextResponse } from 'next/server';
import { getLivePlayerRows } from '@/lib/etlIntegration';
import type { LivePlayerRow } from '@/types/live';

export async function GET() {
  const data: LivePlayerRow[] = await getLivePlayerRows();
  return NextResponse.json({ data });
}
