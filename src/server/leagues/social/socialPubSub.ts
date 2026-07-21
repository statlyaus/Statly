import type { Cluster as IORedisCluster, Redis as IORedisClient } from 'ioredis';
import { z } from 'zod';

import { logger } from '@/lib/logger';
import { shouldDisableRedisClients } from '@/lib/redisConfig';
import { getPublisherClient, getSubscriberClient } from '@/server/realtime/scalableConnection';
import type { SocialRealtimeEnvelope } from '@/types/social';

const SocialEnvelopeSchema = z.object({
  id: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  leagueId: z.string().min(1),
  seasonId: z.string().min(1),
  channel: z.enum(['chat', 'board', 'activity']),
  event: z.enum([
    'social:message',
    'social:activity',
    'social:post',
    'social:reply',
    'social:moderation',
    'social:read-state',
  ]),
  payload: z.unknown(),
  occurredAt: z.string().min(1),
});

const PubSubEnvelopeSchema = z.object({
  version: z.literal(1),
  instanceId: z.string().min(1),
  event: SocialEnvelopeSchema,
});

const INSTANCE_ID = `${process.pid}-${Math.random().toString(36).slice(2)}`;

function channelPrefix(): string {
  return process.env.SOCIAL_REALTIME_CHANNEL_PREFIX || 'social-events';
}

function channelForLeague(leagueId: string): string {
  return `${channelPrefix()}:${leagueId}`;
}

type RedisPubSubClient = IORedisClient | IORedisCluster;

class SocialPubSub {
  private publisher?: RedisPubSubClient;
  private subscriber?: RedisPubSubClient;
  private started = false;

  async start(onEvent: (event: SocialRealtimeEnvelope) => Promise<void> | void): Promise<void> {
    if (shouldDisableRedisClients() || this.started) return;

    const pattern = `${channelPrefix()}:*`;
    const subscriber = (this.subscriber ??= getSubscriberClient());
    await subscriber.psubscribe(pattern);
    subscriber.on('pmessage', (matchedPattern: unknown, _channel: unknown, message: unknown) => {
      if (matchedPattern !== pattern || typeof message !== 'string') return;
      const parsed = PubSubEnvelopeSchema.safeParse(parseJson(message));
      if (!parsed.success) {
        logger.warn('Ignored invalid league social pubsub event', {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path,
            code: issue.code,
          })),
        });
        return;
      }
      if (parsed.data.instanceId === INSTANCE_ID) return;
      const event = parsed.data.event as SocialRealtimeEnvelope;
      void Promise.resolve(onEvent(event)).catch((error) => {
        logger.warn('Failed to dispatch league social pubsub event', {
          leagueId: event.leagueId,
          eventId: event.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
    this.started = true;
    logger.info('League social pubsub subscriber started', { pattern });
  }

  async publish(event: SocialRealtimeEnvelope): Promise<void> {
    if (shouldDisableRedisClients()) return;
    const publisher = (this.publisher ??= getPublisherClient());
    await publisher.publish(
      channelForLeague(event.leagueId),
      JSON.stringify({
        version: 1,
        instanceId: INSTANCE_ID,
        event,
      })
    );
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export const socialPubSub = new SocialPubSub();
