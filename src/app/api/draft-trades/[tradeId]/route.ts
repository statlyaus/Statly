import type { NextRequest } from 'next/server';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { getDraftTradeById } from '@/lib/draftTrades/read';
import { logger } from '@/lib/logger';
import { parseAflTradePublicRouteParam } from '@/server/aflTradeIntelligence/runtime/publicTradeRouteParam';
import { limitPublicTradeRequest } from '@/server/aflTradeIntelligence/runtime/publicTradeRateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tradeId: string }> }
) {
  const limited = await limitPublicTradeRequest(request);
  if (limited) return limited;
  try {
    const { tradeId: rawTradeId } = await params;
    const tradeId = parseAflTradePublicRouteParam(rawTradeId);
    if (tradeId === null) {
      return commonErrors.badRequest('Invalid trade id');
    }

    const detail = await getDraftTradeById(tradeId);
    if (!detail) {
      return commonErrors.notFound('Trade not found');
    }

    return successResponse(detail);
  } catch (error) {
    logger.error('Failed to load draft trade detail', error);
    return commonErrors.internalServerError('Failed to load draft trade detail');
  }
}
