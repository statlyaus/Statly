import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { AFL_TRADE_PUBLIC_VALUE_SCOPE } from '@/server/aflTradeIntelligence/publication/publicationReadContracts';
import { AflTradeValueReadError } from '@/server/aflTradeIntelligence/publication/valueReadService';
import { getPublicAflTradeReadRuntime } from '@/server/aflTradeIntelligence/runtime/publicReadRuntime';
import { aflTradePublicIdSchema, aflTradeValuationViewSchema } from '@/types/aflTradeIntelligence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z
  .object({
    tradeIds: z.array(aflTradePublicIdSchema).min(1).max(100),
    view: aflTradeValuationViewSchema.default('current'),
    limit: z.coerce.number().int().min(1).max(100),
    cursor: z.string().trim().min(1).max(1000).nullable(),
  })
  .strict();

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tradeIds = url.searchParams.getAll('tradeId');
  const parsed = querySchema.safeParse({
    tradeIds,
    view: url.searchParams.get('view') ?? undefined,
    limit: url.searchParams.get('limit') ?? String(Math.max(tradeIds.length, 1)),
    cursor: url.searchParams.get('cursor'),
  });
  if (!parsed.success) {
    return commonErrors.badRequest('Invalid AFL trade valuation query');
  }

  try {
    const { valueReadService } = await getPublicAflTradeReadRuntime();
    const response = await valueReadService.list({
      scopeKey: AFL_TRADE_PUBLIC_VALUE_SCOPE,
      requestedView: parsed.data.view,
      tradeIds: parsed.data.tradeIds,
      limit: parsed.data.limit,
      cursor: parsed.data.cursor,
    });
    return successResponse(response);
  } catch (error) {
    if (error instanceof AflTradeValueReadError) {
      if (error.code === 'INVALID_REQUEST' || error.code === 'UNSUPPORTED_VIEW') {
        return commonErrors.badRequest('Invalid AFL trade valuation query');
      }
      return commonErrors.serviceUnavailable('AFL trade valuation is temporarily unavailable');
    }
    logger.error('Failed to load AFL trade valuations', error);
    return commonErrors.internalServerError('Failed to load AFL trade valuations');
  }
}
