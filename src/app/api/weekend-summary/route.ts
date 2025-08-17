export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Temporarily disabled AI summary due to missing API key
    const summary = "AFL weekend summary: Great performances across all categories! Check the rankings page for detailed player statistics and performance metrics.";
    
    return NextResponse.json({ summary });
  } catch (error) {
    console.error('weekend-summary error', error);
    return NextResponse.json(
      {
        summary:
          'Weekend summary temporarily unavailable. Check back soon for the latest AFL highlights!',
      },
      { status: 500 }
    );
  }
}
