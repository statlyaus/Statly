// API endpoint for league presets and format configurations

import { NextResponse } from 'next/server';
import { LEAGUE_PRESETS } from '@/lib/scheduling';

export async function GET() {
  try {
    return NextResponse.json({
      presets: LEAGUE_PRESETS,
      playoffFormats: {}, // TODO: Add playoff formats if needed
    });
  } catch (error) {
    console.error('Error fetching league presets:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
