import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { loadAuthorizedLeagueDetail } from '@/server/leagues/leagueDetail';

// GET /api/leagues/[id] - Get specific league details
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: leagueId } = await params;
    const userId = await getAuthenticatedUserId(req);
    const result = await loadAuthorizedLeagueDetail(leagueId, userId);

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json(
      { success: true, data: { league: result.league, members: result.members } },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    logger.error('Failed to fetch league', {
      error: {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return NextResponse.json(
      { success: false, error: 'Failed to fetch league details' },
      { status: 500 }
    );
  }
}
