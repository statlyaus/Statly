import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { metricsCollector } from '@/lib/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Lazily initialize on first request to avoid capturing module import time
let startedAtTimestamp: number | null = null;
function getStartedAt(): number {
  if (startedAtTimestamp === null) {
    startedAtTimestamp = Date.now();
  }
  return startedAtTimestamp;
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const metrics = await metricsCollector.collectAllMetrics(getStartedAt());
    return NextResponse.json(metrics, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('GET /api/metrics failed:', error);
    return NextResponse.json(
      { error: 'Failed to collect metrics' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}


