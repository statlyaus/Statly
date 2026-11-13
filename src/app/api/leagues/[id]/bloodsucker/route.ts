import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import {
  BloodsuckerReadError,
  loadBloodsuckerSummary,
} from '@/server/leagues/bloodsuckerReadModel';

import { privateHeaders } from '../bites/biteErrorResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Bloodsucker 9/9 (#1286, BR-40): the Bloodsucker, its record and this season's bites, for members.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized', code: 'UNAUTHORIZED' },
        { status: 401, headers: privateHeaders }
      );
    }
    const { id: leagueId } = await params;
    const summary = await loadBloodsuckerSummary({ leagueId, userId });
    return NextResponse.json(summary, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof BloodsuckerReadError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: privateHeaders }
      );
    }
    logger.apiError('GET', '/api/leagues/[id]/bloodsucker', error);
    return NextResponse.json(
      { error: 'Internal Server Error', code: 'INTERNAL_ERROR' },
      { status: 500, headers: privateHeaders }
    );
  }
}
