import type { NextRequest } from 'next/server';
import { commonErrors, successResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { AflTradeMethodologyReadError } from '@/server/aflTradeIntelligence/publication/methodologyReadService';
import { AFL_TRADE_PUBLIC_VALUE_SCOPE } from '@/server/aflTradeIntelligence/publication/publicationReadContracts';
import { getPublicAflTradeReadRuntime } from '@/server/aflTradeIntelligence/runtime/publicReadRuntime';
import { limitPublicTradeRequest } from '@/server/aflTradeIntelligence/runtime/publicTradeRateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const limited = await limitPublicTradeRequest(request);
  if (limited) return limited;
  try {
    const { methodologyReadService } = await getPublicAflTradeReadRuntime();
    const response = await methodologyReadService.read({
      scopeKey: AFL_TRADE_PUBLIC_VALUE_SCOPE,
    });
    return successResponse(response);
  } catch (error) {
    if (error instanceof AflTradeMethodologyReadError) {
      if (error.code === 'INVALID_REQUEST') {
        return commonErrors.badRequest('Invalid AFL trade methodology request');
      }
      return commonErrors.serviceUnavailable('AFL trade methodology is temporarily unavailable');
    }
    logger.error('Failed to load AFL trade methodology', error);
    return commonErrors.internalServerError('Failed to load AFL trade methodology');
  }
}
