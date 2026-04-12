import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { searchDraftTrades } from '@/lib/draftTrades/search';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  q: z.string().trim().min(2).max(120),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      q: url.searchParams.get('q'),
      limit: url.searchParams.get('limit') ?? undefined,
    });
    if (!parsed.success) {
      return commonErrors.badRequest('Invalid search query');
    }

    const hits = await searchDraftTrades(parsed.data.q, parsed.data.limit ?? 50);
    return successResponse(
      {
        q: parsed.data.q,
        hits,
      },
      200,
      { total: hits.length }
    );
  } catch (error) {
    logger.error('Failed to search draft trades', error);
    return commonErrors.internalServerError('Failed to search draft trades');
  }
}
