import { z } from 'zod';
import { adminAuth } from '@/lib/firebaseAdmin';
import { logger } from '@/lib/logger';
import { commonErrors, errorResponse, successResponse } from '@/lib/apiResponse';
import { revalidateTag } from 'next/cache';
import { tags } from '@/lib/cacheTags';
import { TradeServiceError } from '@/server/leagues/trades/tradeContracts';
import { authorizeLeagueTradeAccess } from '@/server/leagues/trades/tradeService';

const playerSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
});

const bodySchema = z.object({
  incoming: z.array(playerSchema),
  outgoing: z.array(playerSchema),
});

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return commonErrors.unauthorized();
    }
    let userId: string | undefined;
    try {
      userId = (await adminAuth.verifyIdToken(token)).uid;
    } catch {
      return commonErrors.unauthorized();
    }
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

    const requestedLeagueId = request.headers.get('x-league-id')?.trim() || undefined;
    const authorizedLeagueId = requestedLeagueId
      ? await authorizeLeagueTradeAccess(requestedLeagueId, userId)
      : undefined;
    try {
      if (authorizedLeagueId) {
        const results = await Promise.allSettled([
          revalidateTag(tags.trades(authorizedLeagueId), { expire: 0 }),
          revalidateTag(tags.league(authorizedLeagueId), { expire: 0 }),
        ]);
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed) {
          logger.warn('Trades revalidation failed', { leagueId: authorizedLeagueId, failed });
        }
      }
    } catch (e) {
      logger.warn('Trades revalidation error', { leagueId: authorizedLeagueId, error: e });
    }
    return successResponse({ message: 'Trade offer processed successfully' });
  } catch (err) {
    if (err instanceof TradeServiceError) {
      return errorResponse(err.message, err.status, err.code);
    }
    logger.error('Error processing trade offer', err);
    return commonErrors.internalServerError('Server error');
  }
}
