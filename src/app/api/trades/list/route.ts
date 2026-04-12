import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { TradeReviewStatus, TradeStatus } from '@prisma/client';

import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUserId } from '@/lib/serverAuth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const userId = await getAuthenticatedUserId(request as NextRequest);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const pageSize = Math.min(Math.max(parseInt(searchParams.get('pageSize') || '20', 10), 1), 100);
    const cursor = searchParams.get('cursor') || undefined;
    const leagueId = searchParams.get('leagueId') || undefined;
    const statusParam = searchParams.get('status') || undefined;
    const status =
      statusParam && Object.values(TradeStatus).includes(statusParam as TradeStatus)
        ? (statusParam as TradeStatus)
        : undefined;

    const trades = await prisma.trade.findMany({
      where: {
        ...(leagueId ? { leagueId } : {}),
        ...(status ? { status } : { reviewStatus: TradeReviewStatus.PENDING }),
        OR: [
          { proposerUserId: userId },
          { recipientUserId: userId },
          { league: { members: { some: { userId } } } },
        ],
      },
      include: {
        reviewVotes: {
          select: {
            voteType: true,
          },
        },
      },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pageSize,
    });

    const nextCursor = trades.length === pageSize ? (trades[trades.length - 1]?.id ?? null) : null;

    return NextResponse.json(
      {
        trades: trades.map((trade) => ({
          tradeId: trade.id,
          summary: {
            tradeId: trade.id,
            status: trade.status,
            reviewStatus: trade.reviewStatus,
            reviewMode: trade.reviewMode,
            teamCount: 2,
            vetoCount: trade.reviewVotes.filter((vote) => vote.voteType === 'VETO').length,
            participantUserIds: [trade.proposerUserId, trade.recipientUserId],
            lastUpdated:
              trade.reviewDecidedAt?.toISOString() ??
              trade.reviewRequestedAt?.toISOString() ??
              trade.acceptedAt?.toISOString() ??
              trade.createdAt.toISOString(),
          },
        })),
        pageInfo: {
          nextCursor,
          pageSize,
          filters: {
            status: status ?? null,
            leagueId: leagueId ?? null,
          },
        },
      },
      {
        headers: {
          'Cache-Control':
            'public, max-age=0, s-maxage=30, stale-while-revalidate=30, stale-if-error=60',
        },
      }
    );
  } catch (error) {
    logger.error(
      'Failed to list trades',
      error instanceof Error ? error : new Error(String(error))
    );
    return NextResponse.json({ error: 'Failed to list trades' }, { status: 500 });
  }
}
