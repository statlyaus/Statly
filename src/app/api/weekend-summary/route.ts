export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';

export async function GET() {
  try {
    // Temporarily disabled AI summary due to missing API key
    const summary =
      'AFL weekend summary: Great performances across all categories! Check the rankings page for detailed player statistics and performance metrics.';

    return NextResponse.json({ summary });
  } catch (error) {
    logger.error('Weekend summary error', error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json(
      {
        summary:
          'Weekend summary temporarily unavailable. Check back soon for the latest AFL highlights!',
      },
      { status: 500 }
    );
  }
}
