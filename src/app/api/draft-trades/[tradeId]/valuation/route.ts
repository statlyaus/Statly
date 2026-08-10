import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { getDraftTradeById } from '@/lib/draftTrades/read';
import { logger } from '@/lib/logger';
import { AFL_TRADE_PUBLIC_VALUE_SCOPE } from '@/server/aflTradeIntelligence/publication/publicationReadContracts';
import { AflTradeValueReadError } from '@/server/aflTradeIntelligence/publication/valueReadService';
import { parseAflTradePublicRouteParam } from '@/server/aflTradeIntelligence/runtime/publicTradeRouteParam';
import { getPublicAflTradeReadRuntime } from '@/server/aflTradeIntelligence/runtime/publicReadRuntime';
import {
  AFL_TRADE_VALUATION_VIEWS,
  aflTradePublicIdSchema,
  aflTradeValuationViewSchema,
} from '@/types/aflTradeIntelligence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestSchema = z
  .object({
    tradeId: aflTradePublicIdSchema,
    views: z.array(aflTradeValuationViewSchema).min(1).max(AFL_TRADE_VALUATION_VIEWS.length),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.views).size !== request.views.length) {
      context.addIssue({
        code: 'custom',
        path: ['views'],
        message: 'Requested valuation views must be unique.',
      });
    }
  });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tradeId: string }> }
) {
  const url = new URL(request.url);
  const requestedViews = url.searchParams.getAll('view');
  const { tradeId: rawTradeId } = await params;
  const tradeId = parseAflTradePublicRouteParam(rawTradeId);
  if (tradeId === null) {
    return commonErrors.badRequest('Invalid AFL trade valuation request');
  }
  const parsed = requestSchema.safeParse({
    tradeId,
    views: requestedViews.length > 0 ? requestedViews : AFL_TRADE_VALUATION_VIEWS,
  });
  if (!parsed.success) {
    return commonErrors.badRequest('Invalid AFL trade valuation request');
  }

  try {
    const trade = await getDraftTradeById(parsed.data.tradeId);
    if (!trade) {
      return commonErrors.notFound('Trade not found');
    }

    const { valueReadService } = await getPublicAflTradeReadRuntime();
    const response = await valueReadService.detail({
      scopeKey: AFL_TRADE_PUBLIC_VALUE_SCOPE,
      tradeId: parsed.data.tradeId,
      requestedViews: parsed.data.views,
    });
    return successResponse(response);
  } catch (error) {
    if (error instanceof AflTradeValueReadError) {
      if (error.code === 'INVALID_REQUEST' || error.code === 'UNSUPPORTED_VIEW') {
        return commonErrors.badRequest('Invalid AFL trade valuation request');
      }
      return commonErrors.serviceUnavailable('AFL trade valuation is temporarily unavailable');
    }
    logger.error('Failed to load AFL trade valuation detail', error);
    return commonErrors.internalServerError('Failed to load AFL trade valuation detail');
  }
}
