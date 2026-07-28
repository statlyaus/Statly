import { getPublisherClient, getSubscriberClient } from '@/server/realtime/scalableConnection';
import { logger } from '@/lib/logger';
import { DraftRealtimeStatePayloadSchema } from '@/services/realtime/draftStateWire';
import type { Redis as IORedisClient, Cluster as IORedisCluster } from 'ioredis';
import { z } from 'zod';

// Unified Redis Pub/Sub for cross-instance realtime broadcasting
// Uses a dedicated subscriber connection to avoid interfering with other Redis operations.

export const DRAFT_REALTIME_EVENTS = [
  'draft:state',
  'draft:timer-tick',
  'draft:timer-expired',
  'draft:pick-made',
  'draft:auto-pick',
  'draft:paused',
  'draft:resumed',
  'draft:completed',
  'draft:queue-updated',
  'draft:admin-message',
] as const;
export type DraftRealtimeEventType = (typeof DRAFT_REALTIME_EVENTS)[number];

export interface DraftRealtimeEnvelope {
  v: 1; // version for future-proofing
  event: DraftRealtimeEventType;
  draftId: string;
  payload: unknown;
  instanceId: string; // to avoid self-echo
  ts: number;
}

// Centralized runtime validation for incoming envelopes
const EnvelopeSchema = z.object({
  v: z.literal(1),
  event: z.enum(DRAFT_REALTIME_EVENTS),
  draftId: z.string().min(1),
  payload: z.unknown(), // presence required by being a key; value can be any
  instanceId: z.string().min(1),
  ts: z.number(),
});

export function parseAndValidateEnvelope(raw: string): DraftRealtimeEnvelope | null {
  try {
    const json = JSON.parse(raw);
    const res = EnvelopeSchema.safeParse(json);
    if (!res.success) {
      logger.warn('Invalid realtime envelope received', {
        issues: res.error.issues.map((i) => ({ path: i.path, code: i.code, message: i.message })),
        rawSnippet: raw.slice(0, 500),
      });
      return null;
    }

    if (res.data.event === 'draft:state') {
      const stateResult = DraftRealtimeStatePayloadSchema.safeParse(res.data.payload);
      if (!stateResult.success) {
        logger.warn('Invalid draft realtime state payload received', {
          issues: stateResult.error.issues.map((issue) => ({
            path: issue.path,
            code: issue.code,
            message: issue.message,
          })),
        });
        return null;
      }

      return {
        ...res.data,
        payload: stateResult.data,
      };
    }

    return res.data;
  } catch (e) {
    logger.warn('Failed to parse JSON for realtime envelope', {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

function channelForDraft(draftId: string) {
  const prefix = process.env.REALTIME_CHANNEL_PREFIX || 'draft-events';
  return `${prefix}:${draftId}`;
}

function isNextProductionBuild(): boolean {
  return process.env.NEXT_PHASE === 'phase-production-build' || process.env.REDIS_DISABLED === '1';
}

// We generate a simple instance id based on pid + time to de-dupe self messages
const INSTANCE_ID = `${process.pid}-${Math.random().toString(36).slice(2)}`;

export class DraftPubSub {
  private pub?: IORedisClient | IORedisCluster;
  private sub?: IORedisClient | IORedisCluster;
  private started = false;

  private getPublisher(): IORedisClient | IORedisCluster {
    this.pub ??= getPublisherClient();
    return this.pub;
  }

  private getSubscriber(): IORedisClient | IORedisCluster {
    this.sub ??= getSubscriberClient();
    return this.sub;
  }

  async start(onEvent: (msg: DraftRealtimeEnvelope) => void): Promise<void> {
    if (isNextProductionBuild()) return;
    if (this.started) return;
    this.started = true;
    const sub = this.getSubscriber();

    const prefix = process.env.REALTIME_CHANNEL_PREFIX || 'draft-events';
    try {
      // Type-safe pattern subscription
      if ('psubscribe' in sub && typeof sub.psubscribe === 'function') {
        await sub.psubscribe(`${prefix}:*`);
      } else {
        throw new Error('Redis client does not support pattern subscription');
      }

      const handler = (_pattern: unknown, _channel: unknown, message: unknown) => {
        if (_pattern !== `${prefix}:*`) return;
        if (typeof message !== 'string') {
          logger.warn('Received non-string message from Redis', { messageType: typeof message });
          return;
        }
        const data = parseAndValidateEnvelope(message);
        if (!data) return; // invalid
        if (data.instanceId === INSTANCE_ID) return; // ignore our own
        try {
          onEvent(data);
        } catch (e) {
          logger.warn('Realtime onEvent handler failed', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      };

      if ('on' in sub && typeof sub.on === 'function') {
        sub.on('pmessage', handler);
      } else {
        throw new Error('Redis client does not support event listeners');
      }

      logger.info('DraftPubSub subscriber started', { pattern: `${prefix}:*` });
    } catch (e) {
      logger.error('Failed to start DraftPubSub subscriber', {
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  async publish(draftId: string, event: DraftRealtimeEventType, payload: unknown): Promise<void> {
    if (isNextProductionBuild()) return;

    const envelope: DraftRealtimeEnvelope = {
      v: 1,
      event,
      draftId,
      payload,
      instanceId: INSTANCE_ID,
      ts: Date.now(),
    };

    try {
      await this.getPublisher().publish(channelForDraft(draftId), JSON.stringify(envelope));
    } catch (e) {
      logger.error('Failed to publish realtime event', {
        event,
        draftId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

export const draftPubSub = new DraftPubSub();
