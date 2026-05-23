import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { getDraftTradeById } from '@/lib/draftTrades/firestore';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({
  tradeId: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tradeId: string }> }
) {
  try {
    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) {
      return commonErrors.badRequest('Invalid trade id');
    }

    const detail = await getDraftTradeById(parsed.data.tradeId);
    if (!detail) {
      return commonErrors.notFound('Trade not found');
    }

    return successResponse(detail);
  } catch (error) {
    logger.error('Failed to load draft trade detail', error);
    return commonErrors.internalServerError('Failed to load draft trade detail');
  }
}
