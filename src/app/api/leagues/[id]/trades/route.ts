import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { z } from 'zod';

import { adminDb } from '@/lib/firebaseAdmin';
import { logLeagueActivity } from '@/lib/activity';
import { tags } from '@/lib/cacheTags';
import { logger } from '@/lib/logger';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { LeagueTradeService, TradeMutationError } from '@/server/trades/LeagueTradeService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const tradeSchema = z.object({
  recipientMemberId: z.string().trim().min(1).optional(),
  toTeamId: z.string().trim().min(1).optional(),
  playersOffered: z.array(z.string().trim().min(1)).default([]),
  playersRequested: z.array(z.string().trim().min(1)).default([]),
  picksOffered: z.array(z.unknown()).default([]),
  picksRequested: z.array(z.unknown()).default([]),
  message: z.string().trim().max(1000).optional(),
  expiresAt: z.union([z.string(), z.number(), z.date()]).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: leagueId } = await params;
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 });

    const userId = await getAuthenticatedUserId(req);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = tradeSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid trade payload', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const input = parsed.data;
    if (input.picksOffered.length > 0 || input.picksRequested.length > 0) {
      return NextResponse.json(
        { error: 'Draft-pick assets are not supported by the canonical trade system yet' },
        { status: 400 }
      );
    }
    const recipientMemberId = input.recipientMemberId ?? input.toTeamId;
    if (!recipientMemberId) {
      return NextResponse.json({ error: 'A receiving team is required' }, { status: 400 });
    }

    const trade = await new LeagueTradeService().createProposal({
      leagueId,
      proposerUserId: userId,
      recipientMemberId,
      playersOffered: input.playersOffered,
      playersRequested: input.playersRequested,
      message: input.message,
      expiresAt: toTradeExpiry(input.expiresAt),
    });

    await Promise.allSettled([
      projectTradeToFirestore(trade),
      logLeagueActivity(leagueId, 'trade-proposed', {
        tradeId: trade.id,
        fromUserId: trade.proposer.userId,
        toUserId: trade.recipient.userId,
        fromTeamId: trade.proposerMemberId,
        toTeamId: trade.recipientMemberId,
        playersOffered: input.playersOffered,
        playersRequested: input.playersRequested,
      }),
      revalidateTag(tags.trades(leagueId)),
      revalidateTag(tags.league(leagueId)),
    ]);

    return NextResponse.json({ id: trade.id }, { status: 201 });
  } catch (error) {
    if (error instanceof TradeMutationError) {
      const status = error.code === 'TEAM_NOT_FOUND' ? 404 : error.code === 'FORBIDDEN' ? 403 : 409;
      return NextResponse.json({ error: error.message }, { status });
    }
    logger.apiError('POST', '/api/leagues/[id]/trades', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function projectTradeToFirestore(trade: {
  id: string;
  leagueId: string;
  proposerMemberId: string;
  recipientMemberId: string;
  expiresAt: Date;
  message: string | null;
  players: Array<{ playerId: string; fromMemberId: string }>;
  proposer: { userId: string };
  recipient: { userId: string };
}): Promise<void> {
  const playersOffered = trade.players
    .filter((player) => player.fromMemberId === trade.proposerMemberId)
    .map((player) => player.playerId);
  const playersRequested = trade.players
    .filter((player) => player.fromMemberId === trade.recipientMemberId)
    .map((player) => player.playerId);

  await adminDb
    .collection('leagues')
    .doc(trade.leagueId)
    .collection('trades')
    .doc(trade.id)
    .set(
      {
        canonicalTradeId: trade.id,
        leagueId: trade.leagueId,
        fromTeamId: trade.proposerMemberId,
        toTeamId: trade.recipientMemberId,
        fromUserId: trade.proposer.userId,
        toUserId: trade.recipient.userId,
        playersOffered,
        playersRequested,
        status: 'PENDING',
        ...(trade.message ? { message: trade.message } : {}),
        expiresAt: trade.expiresAt,
        updatedAt: new Date(),
      },
      { merge: true }
    );
}

function toTradeExpiry(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' || typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date(Date.now() + 72 * 60 * 60 * 1000);
}
