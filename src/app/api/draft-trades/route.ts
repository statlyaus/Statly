import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { listDraftTradeYears, listDraftTradesByYear } from '@/lib/draftTrades/firestore';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  year: z.coerce.number().int().min(1900).max(2100),
  club: z.string().trim().toLowerCase().min(1).optional(),
  type: z.enum(['player', 'pick', 'future_pick']).optional(),
  q: z.string().trim().min(1).max(120).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      year: url.searchParams.get('year'),
      club: url.searchParams.get('club') ?? undefined,
      type: url.searchParams.get('type') ?? undefined,
      q: url.searchParams.get('q') ?? undefined,
    });

    if (!parsed.success) {
      return commonErrors.badRequest('Invalid year');
    }

    const trades = await listDraftTradesByYear(parsed.data.year, {
      clubSlug: parsed.data.club,
      type: parsed.data.type,
      q: parsed.data.q,
    });
    const years = await listDraftTradeYears();
    return successResponse(
      {
        year: parsed.data.year,
        club: parsed.data.club ?? null,
        type: parsed.data.type ?? null,
        q: parsed.data.q ?? null,
        years,
        trades,
      },
      200,
      { total: trades.length }
    );
  } catch (error) {
    logger.error('Failed to list draft trades by year', error);
    return commonErrors.internalServerError('Failed to load draft trades');
  }
}
