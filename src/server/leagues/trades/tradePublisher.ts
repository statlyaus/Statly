import { randomUUID } from 'node:crypto';

import type { LeagueTradeOutboxEvent, Prisma } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';

import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { publishLeagueSocialRealtimeEvent } from '@/server/leagues/social/socialSocket';
import type { SocialRealtimeEnvelope } from '@/types/social';

const MAX_ATTEMPTS = 8;
const STALE_LOCK_MS = 60_000;

/** Socket event every trade outbox row becomes; the payload says which thread changed. */
export const TRADE_REALTIME_EVENT = 'trade:update';

export interface TradeRealtimePayload {
  threadId: string;
  offerId: string | null;
  /** The outbox row's type, e.g. `trade:proposed` or `trade:accepted`. */
  eventType: string;
  status: string | null;
}

/**
 * Delivers pending `LeagueTradeOutboxEvent` rows to league members as `trade:update` events.
 *
 * `tradeService` writes a row in the same transaction as every trade event, so the row is the
 * persisted fact and this publisher only announces it. Delivery reuses the league members' realtime
 * room (joined with `social:join`), its membership re-check and its cross-instance pub/sub.
 * Claim, retry and backoff mirror the league social publisher.
 */
export async function flushTradeOutboxBatch(io: SocketIOServer, batchSize = 50): Promise<number> {
  const now = new Date();
  const staleLockBefore = new Date(now.getTime() - STALE_LOCK_MS);
  const claimable: Prisma.LeagueTradeOutboxEventWhereInput = {
    attempts: { lt: MAX_ATTEMPTS },
    OR: [
      { status: { in: ['PENDING', 'FAILED'] }, availableAt: { lte: now } },
      { status: 'PROCESSING', lockedAt: { lte: staleLockBefore } },
    ],
  };
  const candidates = await prisma.leagueTradeOutboxEvent.findMany({
    where: claimable,
    orderBy: [{ sequence: 'asc' }],
    take: Math.max(1, Math.min(batchSize, 200)),
    select: { sequence: true },
  });
  if (candidates.length === 0) return 0;

  const claimToken = `${process.pid}:${randomUUID()}`;
  await prisma.leagueTradeOutboxEvent.updateMany({
    where: { ...claimable, sequence: { in: candidates.map((candidate) => candidate.sequence) } },
    data: { status: 'PROCESSING', lockedAt: now, lockedBy: claimToken, attempts: { increment: 1 } },
  });
  const claimed = await prisma.leagueTradeOutboxEvent.findMany({
    where: { lockedBy: claimToken, status: 'PROCESSING' },
    orderBy: { sequence: 'asc' },
  });

  let published = 0;
  for (const event of claimed) {
    try {
      await publishLeagueSocialRealtimeEvent(io, buildEnvelope(event));
      await prisma.leagueTradeOutboxEvent.update({
        where: { sequence: event.sequence },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
        },
      });
      published += 1;
    } catch (error) {
      const retryDelayMs = Math.min(60_000, 1_000 * 2 ** Math.max(0, event.attempts));
      await prisma.leagueTradeOutboxEvent.update({
        where: { sequence: event.sequence },
        data: {
          status: 'FAILED',
          availableAt: new Date(Date.now() + retryDelayMs),
          lockedAt: null,
          lockedBy: null,
          lastError: error instanceof Error ? error.message.slice(0, 2_000) : String(error),
        },
      });
      logger.warn('Failed to publish league trade event', {
        eventId: event.id,
        sequence: event.sequence,
        leagueId: event.leagueId,
        attempts: event.attempts,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return published;
}

export function buildTradeRealtimeEnvelope(event: LeagueTradeOutboxEvent): SocialRealtimeEnvelope {
  const stored = parseStoredPayload(event.payloadJson);
  const payload: TradeRealtimePayload = {
    threadId: event.threadId,
    offerId: event.offerId,
    eventType: event.eventType,
    status: typeof stored.status === 'string' ? stored.status : null,
  };
  return {
    id: event.id,
    sequence: event.sequence,
    leagueId: event.leagueId,
    seasonId: event.seasonId,
    channel: 'activity',
    event: TRADE_REALTIME_EVENT,
    payload: { ...payload },
    occurredAt: event.createdAt.toISOString(),
  };
}

const buildEnvelope = buildTradeRealtimeEnvelope;

function parseStoredPayload(value: string): { status?: unknown } {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as { status?: unknown }) : {};
  } catch {
    return {};
  }
}
