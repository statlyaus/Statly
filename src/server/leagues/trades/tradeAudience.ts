import type { Prisma } from '@prisma/client';

import type { SocialRealtimeEnvelope } from '@/types/social';

/**
 * Trade stages only the two teams see: an offer, a counter and how it ended before any review.
 * Acceptance into review, vetoes, a commissioner's ruling and completion stay league-wide
 * (process map transactions-15, owner decision 2026-11-15).
 */
const PRIVATE_TRADE_EVENTS = new Set([
  'trade:proposed',
  'trade:countered',
  'trade:declined',
  'trade:withdrawn',
  'trade:expired',
]);

/**
 * The user ids a `trade:update` may reach: the two teams' users for a private stage, or null for a
 * league-wide event. Read from the database, never from the envelope. A thread that no longer exists
 * has no audience.
 */
export async function privateTradeAudience(
  client: Pick<Prisma.TransactionClient, 'leagueTradeThread'>,
  envelope: SocialRealtimeEnvelope
): Promise<Set<string> | null> {
  if (envelope.event !== 'trade:update') return null;
  const payload = envelope.payload as { threadId?: unknown; eventType?: unknown };
  if (typeof payload.eventType !== 'string' || !PRIVATE_TRADE_EVENTS.has(payload.eventType)) {
    return null;
  }
  if (typeof payload.threadId !== 'string') return new Set();
  const thread = await client.leagueTradeThread.findUnique({
    where: { id: payload.threadId },
    select: { memberOne: { select: { userId: true } }, memberTwo: { select: { userId: true } } },
  });
  if (!thread) return new Set();
  return new Set([thread.memberOne.userId, thread.memberTwo.userId]);
}
