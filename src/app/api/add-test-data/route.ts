import { type NextRequest, NextResponse } from 'next/server';

import { revalidatePlayersTags } from '@/lib/cache';
import { adminDb } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

const testData = [
  {
    id: 'stats_001',
    player_id: 'player_001',
    player_name: 'Charlie Curnow',
    team: 'Carlton',
    position: 'FWD',
    fantasy_points: 98,
    goals: 3,
    disposals: 18,
    marks: 8,
    tackles: 4,
    season: 2025,
    round_number: 1,
    created_at: new Date().toISOString(),
  },
  {
    id: 'stats_002',
    player_id: 'player_002',
    player_name: 'Patrick Cripps',
    team: 'Carlton',
    position: 'MID',
    fantasy_points: 124,
    goals: 1,
    disposals: 32,
    marks: 6,
    tackles: 8,
    season: 2025,
    round_number: 1,
    created_at: new Date().toISOString(),
  },
  {
    id: 'stats_003',
    player_id: 'player_003',
    player_name: 'Dustin Martin',
    team: 'Richmond',
    position: 'MID',
    fantasy_points: 108,
    goals: 2,
    disposals: 25,
    marks: 5,
    tackles: 6,
    season: 2025,
    round_number: 1,
    created_at: new Date().toISOString(),
  },
];

export async function POST(_request: NextRequest) {
  try {
    if (process.env.NODE_ENV !== 'development') {
      return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 });
    }
    const db = adminDb;

    logger.info('Adding test data to Firebase...');

    // Add each player stat
    for (const stat of testData) {
      await db.collection('player_match_stats').doc(stat.id).set(stat);
      logger.info(`Added: ${stat.player_name} - ${stat.fantasy_points} points`);
    }

    // Invalidate cache/tags for readers depending on player stats
    await revalidatePlayersTags();

    return NextResponse.json({
      success: true,
      message: 'Test data added successfully',
      count: testData.length,
      data: testData,
    });
  } catch (error) {
    logger.error('Failed to add test data', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to add test data',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ success: false, error: 'forbidden' }, { status: 403 });
  }

  return NextResponse.json({
    message: 'Use POST to add test data to Firebase',
    data: testData,
  });
}
