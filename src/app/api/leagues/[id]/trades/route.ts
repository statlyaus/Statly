import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import {
  TRADE_VIEWS,
  TradeServiceError,
  type TradeView,
} from '@/server/leagues/trades/tradeContracts';
import { loadAuthorizedLeagueTradeCentre } from '@/server/leagues/trades/tradeReadModel';
import { createLeagueTrade } from '@/server/leagues/trades/tradeService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const privateHeaders = { 'Cache-Control': 'private, no-store' };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) return tradeError(new TradeServiceError('UNAUTHORIZED', 'Unauthorized', 401));

    const { id: leagueId } = await params;
    const { searchParams } = new URL(request.url);
    const view = parseView(searchParams.get('view'));
    const pageSize = parsePageSize(searchParams.get('pageSize'));
    const snapshot = await loadAuthorizedLeagueTradeCentre({
      leagueId,
      userId,
      view,
      cursor: searchParams.get('cursor'),
      pageSize,
    });

    return NextResponse.json(snapshot, { headers: privateHeaders });
  } catch (error) {
    return handleTradeRouteError('GET', error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) return tradeError(new TradeServiceError('UNAUTHORIZED', 'Unauthorized', 401));

    const { id: leagueId } = await params;
    const input = await request.json().catch(() => undefined);
    const result = await createLeagueTrade(leagueId, userId, input);

    return NextResponse.json(result, { status: 201, headers: privateHeaders });
  } catch (error) {
    return handleTradeRouteError('POST', error);
  }
}

function parseView(value: string | null): TradeView {
  if (!value) return 'inbox';
  if ((TRADE_VIEWS as readonly string[]).includes(value)) return value as TradeView;
  throw new TradeServiceError('INVALID_INPUT', 'Unknown trade view.');
}

function parsePageSize(value: string | null): number {
  if (!value) return 20;
  if (!/^\d+$/.test(value)) {
    throw new TradeServiceError('INVALID_INPUT', 'pageSize must be an integer between 1 and 50.');
  }
  const pageSize = Number(value);
  if (pageSize < 1 || pageSize > 50) {
    throw new TradeServiceError('INVALID_INPUT', 'pageSize must be an integer between 1 and 50.');
  }
  return pageSize;
}

function handleTradeRouteError(method: 'GET' | 'POST', error: unknown) {
  if (error instanceof TradeServiceError) return tradeError(error);
  logger.apiError(method, '/api/leagues/[id]/trades', error);
  return NextResponse.json(
    { error: 'Internal Server Error', code: 'INTERNAL_ERROR' },
    { status: 500, headers: privateHeaders }
  );
}

function tradeError(error: TradeServiceError) {
  return NextResponse.json(
    { error: error.message, code: error.code },
    { status: error.status, headers: privateHeaders }
  );
}
