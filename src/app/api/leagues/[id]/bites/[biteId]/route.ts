import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { BiteError, executeBite } from '@/server/leagues/bloodsuckerBites';
import { BloodsuckerReadError, loadBitePicker } from '@/server/leagues/bloodsuckerReadModel';
import { RosterSwapError } from '@/server/leagues/rosterSwap';

import { biteErrorResponse, privateHeaders } from '../biteErrorResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Bloodsucker 9/9 (#1286, US-6): the bite picker, for the Bloodsucker only.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; biteId: string }> }
) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) return biteErrorResponse(new BiteError('UNAUTHORIZED', 'Unauthorized', 401));
    const { id: leagueId, biteId } = await params;
    const picker = await loadBitePicker({ leagueId, biteId, userId });
    return NextResponse.json(picker, { status: 200, headers: privateHeaders });
  } catch (error) {
    if (error instanceof BloodsuckerReadError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: privateHeaders }
      );
    }
    logger.apiError('GET', '/api/leagues/[id]/bites/[biteId]', error);
    return NextResponse.json(
      { error: 'Internal Server Error', code: 'INTERNAL_ERROR' },
      { status: 500, headers: privateHeaders }
    );
  }
}

// Bloodsucker 6/9 (#1283): the Bloodsucker executes a bite it won, taking one player and returning one.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; biteId: string }> }
) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) return biteErrorResponse(new BiteError('UNAUTHORIZED', 'Unauthorized', 401));

    const { id: leagueId, biteId } = await params;
    const body = await request.json().catch(() => undefined);
    const result = await executeBite({ leagueId, biteId, userId, body });
    return NextResponse.json(result, { status: 200, headers: privateHeaders });
  } catch (error) {
    if (error instanceof BiteError || error instanceof RosterSwapError) {
      return biteErrorResponse(error);
    }
    logger.apiError('POST', '/api/leagues/[id]/bites/[biteId]', error);
    return NextResponse.json(
      { error: 'Internal Server Error', code: 'INTERNAL_ERROR' },
      { status: 500, headers: privateHeaders }
    );
  }
}
