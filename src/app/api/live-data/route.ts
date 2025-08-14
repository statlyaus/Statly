// API route for serving live AFL data
// Place this in src/app/api/live-data/route.ts

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { 
  getLivePlayerStats, 
  getLiveMatches, 
  getDataFreshness,
  transformToLegacyPlayerStats 
} from '@/lib/etlIntegration';

// GET /api/live-data - Get current live data
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'legacy'; // legacy or raw
    const limit = parseInt(searchParams.get('limit') || '100');
    const season = searchParams.get('season') ? parseInt(searchParams.get('season')!) : undefined;

    // Fetch data in parallel
    const [rawPlayerStats, liveMatches, freshness] = await Promise.all([
      getLivePlayerStats(season),
      getLiveMatches(),
      getDataFreshness()
    ]);

    // Transform data based on requested format
    const playerStats = format === 'legacy' 
      ? transformToLegacyPlayerStats(rawPlayerStats.slice(0, limit))
      : rawPlayerStats.slice(0, limit);

    return NextResponse.json({
      success: true,
      data: {
        playerStats,
        liveMatches,
        meta: {
          isLive: freshness.isLive,
          lastUpdate: freshness.lastUpdate,
          minutesSinceUpdate: freshness.minutesSinceUpdate,
          totalPlayers: rawPlayerStats.length,
          totalMatches: liveMatches.length,
          format,
          limit,
          season
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error serving live data:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch live data',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// POST /api/live-data/refresh - Trigger manual refresh
export async function POST() {
  try {
    // This would trigger the ETL pipeline to refresh data
    // For now, just return current data freshness
    const freshness = await getDataFreshness();
    
    return NextResponse.json({
      success: true,
      message: 'Data refresh triggered',
      freshness,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error triggering data refresh:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to trigger data refresh',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
