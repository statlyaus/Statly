import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import {
  AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
  AflDraftTradeOutcomeReadError,
} from '@/server/aflTradeIntelligence/outcomes/outcomeReadService';
import { getPublicAflTradeReadRuntime } from '@/server/aflTradeIntelligence/runtime/publicReadRuntime';
import {
  aflDraftTradeOutcomeCheckStatusSchema,
  aflDraftTradeOutcomeMetricSchema,
} from '@/types/aflDraftTradeOutcomes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z
  .object({
    year: z
      .string()
      .regex(/^\d{4}$/)
      .transform(Number)
      .pipe(z.number().int().min(1897).max(2200))
      .nullable(),
    club: z.string().trim().max(160),
    q: z.string().trim().max(160),
    metric: aflDraftTradeOutcomeMetricSchema.nullable(),
    status: aflDraftTradeOutcomeCheckStatusSchema.nullable(),
    limit: z
      .string()
      .regex(/^\d{1,3}$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(100)),
    cursor: z.string().trim().min(1).max(1000).nullable(),
  })
  .strict();

function singleSearchParam(request: NextRequest, name: string): string | null {
  const values = request.nextUrl.searchParams.getAll(name);
  if (values.length > 1) {
    throw new AflDraftTradeOutcomeReadError(
      'INVALID_REQUEST',
      `The ${name} query parameter must be supplied at most once.`
    );
  }
  return values[0] ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const parsed = querySchema.safeParse({
      year: singleSearchParam(request, 'year'),
      club: singleSearchParam(request, 'club') ?? '',
      q: singleSearchParam(request, 'q') ?? '',
      metric: singleSearchParam(request, 'metric'),
      status: singleSearchParam(request, 'status'),
      limit: singleSearchParam(request, 'limit') ?? '25',
      cursor: singleSearchParam(request, 'cursor'),
    });
    if (!parsed.success) {
      return commonErrors.badRequest('Invalid AFL Draft & Trade outcome query');
    }

    const { outcomeReadService } = await getPublicAflTradeReadRuntime();
    const response = await outcomeReadService.list({
      scopeKey: AFL_DRAFT_TRADE_PUBLIC_OUTCOME_SCOPE,
      ...parsed.data,
    });
    return successResponse(response);
  } catch (error) {
    if (error instanceof AflDraftTradeOutcomeReadError) {
      if (error.code === 'INVALID_REQUEST' || error.code === 'UNSUPPORTED_METRIC') {
        return commonErrors.badRequest('Invalid AFL Draft & Trade outcome query');
      }
      logger.error('AFL Draft & Trade outcome release read failed closed', error, {
        code: error.code,
      });
      return commonErrors.serviceUnavailable(
        'AFL Draft & Trade outcomes are temporarily unavailable'
      );
    }
    logger.error('Failed to load AFL Draft & Trade outcomes', error);
    return commonErrors.internalServerError('Failed to load AFL Draft & Trade outcomes');
  }
}
