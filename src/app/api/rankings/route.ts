import { type NextRequest, NextResponse } from 'next/server';

import { rateLimitConfigs, withRateLimit } from '@/lib/rateLimit';
import { getCategoryRankings } from '@/server/rankings/getCategoryRankings';

export const runtime = 'nodejs';
const CACHE_SECONDS = 300; // 5 minutes cache

const checkRateLimit = withRateLimit(rateLimitConfigs.public);

export async function GET(request: NextRequest) {
  const rateLimit = await checkRateLimit(request);
  if (!rateLimit.success) {
    return NextResponse.json(rateLimit.body, {
      status: rateLimit.status,
      headers: rateLimit.headers,
    });
  }

  try {
    const { searchParams } = new URL(request.url);

    const response = await getCategoryRankings({
      season: parseInt(searchParams.get('season') || '2025'),
      period: searchParams.get('period') || 'season',
      position: searchParams.get('position'),
      ownership: searchParams.get('ownership'),
      leagueId: searchParams.get('leagueId'),
      sortBy: searchParams.get('sortBy') || 'overall',
      sortDirection: searchParams.get('sortDirection') || 'desc',
      limit: parseInt(searchParams.get('limit') || '0'),
      search: searchParams.get('search'),
    });

    return NextResponse.json(
      {
        success: true,
        data: response,
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          'Cache-Control': `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}`,
        },
      }
    );
  } catch (error) {
    console.error('[Rankings API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch rankings',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
