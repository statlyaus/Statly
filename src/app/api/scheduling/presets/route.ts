// API endpoint for league presets and format configurations

import { NextResponse } from 'next/server';
import { LEAGUE_PRESETS, PLAYOFF_FORMATS } from '@/lib/scheduling';

export async function GET() {
  try {
    return NextResponse.json({
      presets: LEAGUE_PRESETS,
      playoffFormats: PLAYOFF_FORMATS,
    });
  } catch (error) {
    console.error('Error fetching league presets:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
