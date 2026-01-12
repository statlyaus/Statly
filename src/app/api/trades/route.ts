import { revalidateTag } from 'next/cache';

import { z } from 'zod';

import { commonErrors, successResponse } from '@/lib/apiResponse';
import { tags } from '@/lib/cacheTags';
import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';

const playerSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
});

const bodySchema = z.object({
  incoming: z.array(playerSchema),
  outgoing: z.array(playerSchema),
});

export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId(request);
    if (!userId) {
      return commonErrors.unauthorized();
    }

    const json = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return commonErrors.badRequest('Invalid payload', {
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const leagueId = request.headers.get('x-league-id') || undefined;
    try {
      if (leagueId) {
        const results = await Promise.allSettled([
          revalidateTag(tags.trades(leagueId)),
          revalidateTag(tags.league(leagueId)),
        ]);
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed) {
          logger.warn('Trades revalidation failed', { leagueId, failed });
        }
      }
    } catch (e) {
      logger.warn('Trades revalidation error', { leagueId, error: e });
    }
    return successResponse({ message: 'Trade offer processed successfully' });
  } catch (err) {
    logger.error('Error processing trade offer', err instanceof Error ? err : new Error(String(err)));
    return commonErrors.internalServerError('Server error');
  }
}
