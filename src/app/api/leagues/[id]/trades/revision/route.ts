import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { TradeServiceError } from '@/server/leagues/trades/tradeContracts';
import { loadAuthorizedLeagueTradeRevision } from '@/server/leagues/trades/tradeReadModel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const privateHeaders = { 'Cache-Control': 'private, no-store' };

// The Trade Centre polls this while no Socket.IO room is delivering trade events (Netlify and CI run
// no Socket.IO process). It is one small aggregate, so the full snapshot reloads only on a change.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) throw new TradeServiceError('UNAUTHORIZED', 'Unauthorized', 401);

    const { id: leagueId } = await params;
    const result = await loadAuthorizedLeagueTradeRevision({ leagueId, userId });
    return NextResponse.json(result, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof TradeServiceError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: privateHeaders }
      );
    }
    logger.apiError('GET', '/api/leagues/[id]/trades/revision', error);
    return NextResponse.json(
      { error: 'Internal Server Error', code: 'INTERNAL_ERROR' },
      { status: 500, headers: privateHeaders }
    );
  }
}
