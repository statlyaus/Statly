import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import {
  BloodsuckerDrawError,
  drawBloodsucker,
  loadBloodsuckerLobbyState,
} from '@/server/leagues/bloodsuckerDraw';

import { privateHeaders } from '../../bites/biteErrorResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Bloodsucker 9/9 (#1286, BR-04b): the lobby draw. GET is the revision poll every lobby client
// replays the reveal from; POST draws once, committing the winner and the audit before it answers.

type Context = { params: Promise<{ id: string }> };

async function handle(
  request: NextRequest,
  context: Context,
  method: 'GET' | 'POST'
): Promise<NextResponse> {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', code: 'UNAUTHORIZED' },
        { status: 401, headers: privateHeaders }
      );
    }
    const { id: leagueId } = await context.params;
    const state =
      method === 'POST'
        ? await drawBloodsucker({ leagueId, userId })
        : await loadBloodsuckerLobbyState({ leagueId, userId });
    return NextResponse.json(state, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof BloodsuckerDrawError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: privateHeaders }
      );
    }
    logger.apiError(method, '/api/leagues/[id]/bloodsucker/draw', error);
    return NextResponse.json(
      { error: 'Internal Server Error', code: 'INTERNAL_ERROR' },
      { status: 500, headers: privateHeaders }
    );
  }
}

export const GET = (request: NextRequest, context: Context) => handle(request, context, 'GET');
export const POST = (request: NextRequest, context: Context) => handle(request, context, 'POST');
