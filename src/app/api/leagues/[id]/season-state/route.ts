import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { getAuthorizedLeagueSeasonState } from '@/server/leagues/seasonState';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    const { id: leagueId } = await params;
    const result = await getAuthorizedLeagueSeasonState({ leagueId, userId });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    return NextResponse.json(
      { success: true, data: result.data },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    logger.error('Failed to load league season state', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: 'Failed to load league season state' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }
}
