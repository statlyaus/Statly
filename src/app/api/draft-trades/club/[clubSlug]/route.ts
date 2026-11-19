import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { listDraftTradeRefsByClub } from '@/lib/draftTrades/read';
import { logger } from '@/lib/logger';
import { limitPublicTradeRequest } from '@/server/aflTradeIntelligence/runtime/publicTradeRateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({
  clubSlug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .transform((value) => value.toLowerCase())
    .refine((value) => /^[a-z0-9][a-z0-9-]*$/.test(value)),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clubSlug: string }> }
) {
  const limited = await limitPublicTradeRequest(request);
  if (limited) return limited;
  try {
    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) {
      return commonErrors.badRequest('Invalid club slug');
    }

    const clubSlug = parsed.data.clubSlug;
    const tradeRefs = await listDraftTradeRefsByClub(clubSlug);
    return successResponse(
      {
        clubSlug,
        tradeRefs,
      },
      200,
      { total: tradeRefs.length }
    );
  } catch (error) {
    logger.error('Failed to list draft trades by club', error);
    return commonErrors.internalServerError('Failed to load club trades');
  }
}
