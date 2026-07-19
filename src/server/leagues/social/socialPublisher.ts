import 'server-only';

import { randomUUID } from 'node:crypto';

import type { SocialOutboxEvent } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';

import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import type { SocialRealtimeEnvelope } from '@/types/social';

import { publishLeagueSocialRealtimeEvent } from './socialSocket';

const MAX_ATTEMPTS = 8;
const STALE_LOCK_MS = 60_000;
const SOCIAL_REALTIME_EVENTS = new Set<SocialRealtimeEnvelope['event']>([
  'social:message',
  'social:activity',
  'social:post',
  'social:reply',
  'social:moderation',
  'social:read-state',
]);

export async function flushSocialOutboxBatch(io: SocketIOServer, batchSize = 50): Promise<number> {
  const now = new Date();
  const staleLockBefore = new Date(now.getTime() - STALE_LOCK_MS);
  const candidates = await prisma.socialOutboxEvent.findMany({
    where: {
      attempts: { lt: MAX_ATTEMPTS },
      OR: [
        {
          status: { in: ['PENDING', 'FAILED'] },
          availableAt: { lte: now },
        },
        {
          status: 'PROCESSING',
          lockedAt: { lte: staleLockBefore },
        },
      ],
    },
    orderBy: [{ sequence: 'asc' }],
    take: Math.max(1, Math.min(batchSize, 200)),
    select: { sequence: true },
  });
  if (candidates.length === 0) return 0;

  const claimToken = `${process.pid}:${randomUUID()}`;
  await prisma.socialOutboxEvent.updateMany({
    where: {
      sequence: { in: candidates.map((candidate) => candidate.sequence) },
      attempts: { lt: MAX_ATTEMPTS },
      OR: [
        {
          status: { in: ['PENDING', 'FAILED'] },
          availableAt: { lte: now },
        },
        {
          status: 'PROCESSING',
          lockedAt: { lte: staleLockBefore },
        },
      ],
    },
    data: {
      status: 'PROCESSING',
      lockedAt: now,
      lockedBy: claimToken,
      attempts: { increment: 1 },
    },
  });

  const claimed = await prisma.socialOutboxEvent.findMany({
    where: { lockedBy: claimToken, status: 'PROCESSING' },
    orderBy: { sequence: 'asc' },
  });

  let published = 0;
  for (const event of claimed) {
    try {
      const envelope = buildEnvelope(event);
      await publishLeagueSocialRealtimeEvent(io, envelope);
      await prisma.socialOutboxEvent.update({
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
      await prisma.socialOutboxEvent.update({
        where: { sequence: event.sequence },
        data: {
          status: 'FAILED',
          availableAt: new Date(Date.now() + retryDelayMs),
          lockedAt: null,
          lockedBy: null,
          lastError: error instanceof Error ? error.message.slice(0, 2_000) : String(error),
        },
      });
      logger.warn('Failed to publish league social event', {
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

function buildEnvelope(event: SocialOutboxEvent): SocialRealtimeEnvelope {
  if (!SOCIAL_REALTIME_EVENTS.has(event.eventType as SocialRealtimeEnvelope['event'])) {
    throw new Error('Invalid league social realtime event type');
  }

  return {
    id: event.id,
    sequence: event.sequence,
    leagueId: event.leagueId,
    seasonId: event.seasonId,
    channel: event.channel === 'CHAT' ? 'chat' : event.channel === 'BOARD' ? 'board' : 'activity',
    event: event.eventType as SocialRealtimeEnvelope['event'],
    payload: parseStoredPayload(event.payloadJson),
    occurredAt: event.createdAt.toISOString(),
  };
}

function parseStoredPayload(value: string): SocialRealtimeEnvelope['payload'] {
  const parsed = JSON.parse(value) as unknown;
  if (
    parsed &&
    typeof parsed === 'object' &&
    'payload' in parsed &&
    'event' in parsed &&
    'channel' in parsed &&
    'sequence' in parsed
  ) {
    const legacyPayload = (parsed as { payload?: unknown }).payload;
    if (legacyPayload !== null && legacyPayload !== undefined) {
      return legacyPayload as SocialRealtimeEnvelope['payload'];
    }
  }
  if (parsed === null || parsed === undefined) {
    throw new Error('Invalid league social realtime payload');
  }
  return parsed as SocialRealtimeEnvelope['payload'];
}
