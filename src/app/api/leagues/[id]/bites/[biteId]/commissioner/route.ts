import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { BiteError, commissionerBiteAction } from '@/server/leagues/bloodsuckerBites';
import { RosterSwapError } from '@/server/leagues/rosterSwap';

import { biteErrorResponse, privateHeaders } from '../../biteErrorResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
