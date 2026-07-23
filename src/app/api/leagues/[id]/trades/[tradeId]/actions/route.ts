import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { TradeServiceError } from '@/server/leagues/trades/tradeContracts';
import { executeLeagueTradeAction } from '@/server/leagues/trades/tradeService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const privateHeaders = { 'Cache-Control': 'private, no-store' };

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tradeId: string }> }
) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) return tradeError(new TradeServiceError('UNAUTHORIZED', 'Unauthorized', 401));

    const { id: leagueId, tradeId } = await params;
    const input = await request.json().catch(() => undefined);
    const result = await executeLeagueTradeAction(leagueId, userId, tradeId, input);

    return NextResponse.json(result, { status: 200, headers: privateHeaders });
  } catch (error) {
    if (error instanceof TradeServiceError) return tradeError(error);
    logger.apiError('POST', '/api/leagues/[id]/trades/[tradeId]/actions', error);
    return NextResponse.json(
      { error: 'Internal Server Error', code: 'INTERNAL_ERROR' },
      { status: 500, headers: privateHeaders }
    );
  }
}

function tradeError(error: TradeServiceError) {
  return NextResponse.json(
    { error: error.message, code: error.code },
    { status: error.status, headers: privateHeaders }
  );
}
