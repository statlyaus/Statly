import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';

import { adminDb } from '@/lib/firebaseAdmin';
import { logLeagueActivity } from '@/lib/activity';
import { tags } from '@/lib/cacheTags';
import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { TradeMutationError, LeagueTradeService } from '@/server/trades/LeagueTradeService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; tradeId: string }> }
) {
  try {
    const { id: leagueId, tradeId } = await params;
    const userId = await getAuthenticatedUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const trade = await new LeagueTradeService().acceptProposal({
      leagueId,
      tradeId,
      recipientUserId: userId,
    });

    await Promise.allSettled([
      adminDb.collection('leagues').doc(leagueId).collection('trades').doc(trade.id).set(
        {
          canonicalTradeId: trade.id,
          status: 'PROCESSED',
          processedAt: trade.processedAt,
          updatedAt: new Date(),
        },
        { merge: true }
      ),
      logLeagueActivity(leagueId, 'trade-processed', {
        tradeId: trade.id,
        fromTeamId: trade.proposerMemberId,
        toTeamId: trade.recipientMemberId,
      }),
      revalidateTag(tags.trades(leagueId)),
      revalidateTag(tags.league(leagueId)),
      revalidateTag(tags.waivers(leagueId)),
    ]);

    return NextResponse.json({
      id: trade.id,
      status: trade.status,
      processedAt: trade.processedAt,
    });
  } catch (error) {
    if (error instanceof TradeMutationError) {
      const status =
        error.code === 'TRADE_NOT_FOUND'
          ? 404
          : error.code === 'FORBIDDEN'
            ? 403
            : error.code === 'INVALID_TRADE'
              ? 400
              : 409;
      return NextResponse.json({ error: error.message }, { status });
    }
    logger.apiError('POST', '/api/leagues/[id]/trades/[tradeId]/accept', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
