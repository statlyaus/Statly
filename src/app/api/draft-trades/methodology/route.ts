import { commonErrors, successResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import {
  AflTradeMethodologyReadError,
  aflTradePrePublicationMethodologyReadService,
} from '@/server/aflTradeIntelligence/publication/methodologyReadService';
import { AFL_TRADE_PUBLIC_VALUE_SCOPE } from '@/server/aflTradeIntelligence/publication/prePublicationValueReadService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const response = await aflTradePrePublicationMethodologyReadService.read({
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
