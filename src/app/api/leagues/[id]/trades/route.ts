import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { z } from 'zod';
import { adminDb } from '@/lib/firebaseAdmin';
import { getAuthenticatedUserId } from '@/lib/serverAuth';
import { verifyLeagueMembership } from '@/lib/leagueMembership';
import { logLeagueActivity } from '@/lib/activity';
import { tags } from '@/lib/cacheTags';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const tradeSchema = z.object({
  fromTeamId: z.string().trim().min(1),
  toTeamId: z.string().trim().min(1),
  fromUserId: z.string().trim().min(1),
  toUserId: z.string().trim().min(1),
  playersOffered: z.array(z.string()).default([]),
  playersRequested: z.array(z.string()).default([]),
  picksOffered: z.array(z.unknown()).default([]),
  picksRequested: z.array(z.unknown()).default([]),
  message: z.string().trim().max(1000).optional(),
  expiresAt: z.union([z.string(), z.number(), z.date()]).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: leagueId } = await params;
    if (!leagueId) {
      return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 });
    }

    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = tradeSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid trade payload', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const trade = parsed.data;
    if (trade.fromUserId !== userId) {
      return NextResponse.json({ error: 'Trade proposer mismatch' }, { status: 403 });
    }

    const [proposerMembership, recipientMembership] = await Promise.all([
      verifyLeagueMembership(leagueId, trade.fromUserId),
      verifyLeagueMembership(leagueId, trade.toUserId),
    ]);

    if (!proposerMembership.isMember || !recipientMembership.isMember) {
      return NextResponse.json(
        { error: 'Trade participants must be league members' },
        { status: 403 }
      );
    }

    const expiresAt = toTradeExpiry(trade.expiresAt);
    const tradeRef = adminDb.collection('leagues').doc(leagueId).collection('trades').doc();
    const tradeDoc = {
      leagueId,
      fromTeamId: trade.fromTeamId,
      toTeamId: trade.toTeamId,
      fromUserId: trade.fromUserId,
      toUserId: trade.toUserId,
      playersOffered: trade.playersOffered,
      playersRequested: trade.playersRequested,
      picksOffered: trade.picksOffered,
      picksRequested: trade.picksRequested,
      status: 'PENDING',
      ...(trade.message ? { message: trade.message } : {}),
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await tradeRef.set(tradeDoc);

    await logLeagueActivity(leagueId, 'trade-proposed', {
      tradeId: tradeRef.id,
      fromUserId: trade.fromUserId,
      toUserId: trade.toUserId,
      fromTeamId: trade.fromTeamId,
      toTeamId: trade.toTeamId,
      playersOffered: trade.playersOffered,
      playersRequested: trade.playersRequested,
    });

    try {
      await Promise.allSettled([
        revalidateTag(tags.trades(leagueId)),
        revalidateTag(tags.league(leagueId)),
      ]);
    } catch (error) {
      logger.warn('Failed to revalidate tags after trade proposal', { leagueId, error });
    }

    return NextResponse.json({ id: tradeRef.id }, { status: 201 });
  } catch (error) {
    logger.apiError('POST', '/api/leagues/[id]/trades', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

function toTradeExpiry(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date(Date.now() + 72 * 60 * 60 * 1000);
}
