import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { BiteError, commissionerBiteAction } from '@/server/leagues/bloodsuckerBites';
import { BloodsuckerReadError, loadBiteReview } from '@/server/leagues/bloodsuckerReadModel';
import { RosterSwapError } from '@/server/leagues/rosterSwap';

import { biteErrorResponse, privateHeaders } from '../../biteErrorResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// #1343 (BR-35, E1): what a commissioner sees before cancelling or redoing a bite, for commissioners
// only. One who is part of the bite gets no actions and the reason.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; biteId: string }> }
) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) return biteErrorResponse(new BiteError('UNAUTHORIZED', 'Unauthorized', 401));
    const { id: leagueId, biteId } = await params;
    const review = await loadBiteReview({ leagueId, biteId, userId });
    return NextResponse.json(review, { status: 200, headers: privateHeaders });
  } catch (error) {
    if (error instanceof BloodsuckerReadError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: privateHeaders }
      );
    }
    logger.apiError('GET', '/api/leagues/[id]/bites/[biteId]/commissioner', error);
    return NextResponse.json(
      { error: 'Internal Server Error', code: 'INTERNAL_ERROR' },
      { status: 500, headers: privateHeaders }
    );
  }
}

// Bloodsucker 6/9 (#1283, BR-35, E1): a commissioner outside the bite cancels or redoes it, with a reason.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; biteId: string }> }
) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) return biteErrorResponse(new BiteError('UNAUTHORIZED', 'Unauthorized', 401));

    const { id: leagueId, biteId } = await params;
    const body = await request.json().catch(() => undefined);
    const result = await commissionerBiteAction({ leagueId, biteId, userId, body });
    return NextResponse.json(result, { status: 200, headers: privateHeaders });
  } catch (error) {
    if (error instanceof BiteError || error instanceof RosterSwapError) {
      return biteErrorResponse(error);
    }
    logger.apiError('POST', '/api/leagues/[id]/bites/[biteId]/commissioner', error);
    return NextResponse.json(
      { error: 'Internal Server Error', code: 'INTERNAL_ERROR' },
      { status: 500, headers: privateHeaders }
    );
  }
}
