import { getPublisherClient, getSubscriberClient } from '@/server/realtime/scalableConnection';
import { logger } from '@/lib/logger';
import {
  DraftRealtimeV2EventEnvelopeSchema,
  type DraftRealtimeV2EventEnvelope,
} from '@/services/realtime/draftRealtimeV2';
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
  'draft:admin-message',
] as const;
export type DraftRealtimeEventType = (typeof DRAFT_REALTIME_EVENTS)[number];

export interface DraftRealtimeEnvelopeV1 {
  v: 1; // version for future-proofing
  event: DraftRealtimeEventType;
  draftId: string;
  payload: unknown;
  instanceId: string; // to avoid self-echo
  ts: number;
}

export interface DraftRealtimePubSubEnvelopeV2 {
  v: 2;
  message: DraftRealtimeV2EventEnvelope;
  instanceId: string;
  publishedAt: number;
}

export type DraftRealtimeEnvelope = DraftRealtimeEnvelopeV1 | DraftRealtimePubSubEnvelopeV2;

// Centralized runtime validation for incoming envelopes
const EnvelopeV1Schema = z.object({
  v: z.literal(1),
  event: z.enum(DRAFT_REALTIME_EVENTS),
  draftId: z.string().min(1),
  payload: z.unknown(), // presence required by being a key; value can be any
  instanceId: z.string().min(1),
  ts: z.number(),
});

const EnvelopeV2Schema = z
  .object({
    v: z.literal(2),
    message: DraftRealtimeV2EventEnvelopeSchema,
    instanceId: z.string().min(1),
    publishedAt: z.number().int().nonnegative(),
  })
  .strict();

export function parseAndValidateEnvelope(
  raw: string,
  expectedDraftId?: string
): DraftRealtimeEnvelope | null {
  try {
    const json = JSON.parse(raw);
    const res = json?.v === 2 ? EnvelopeV2Schema.safeParse(json) : EnvelopeV1Schema.safeParse(json);
    if (!res.success) {
      logger.warn('Invalid realtime envelope received', {
        issues: res.error.issues.map((i) => ({ path: i.path, code: i.code, message: i.message })),
        rawSnippet: raw.slice(0, 500),
      });
      return null;
    }

    if (res.data.v === 2) {
      if (expectedDraftId && res.data.message.draftId !== expectedDraftId) {
        logger.warn('Draft realtime v2 channel scope mismatch', {
          expectedDraftId,
          envelopeDraftId: res.data.message.draftId,
        });
        return null;
      }
      return res.data;
    }

    if (expectedDraftId && res.data.draftId !== expectedDraftId) {
      logger.warn('Draft realtime channel scope mismatch', {
        expectedDraftId,
        envelopeDraftId: res.data.draftId,
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

      if (stateResult.data.draftId !== res.data.draftId) {
        logger.warn('Draft realtime state envelope draftId mismatch', {
          envelopeDraftId: res.data.draftId,
          payloadDraftId: stateResult.data.draftId,
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
  private startPromise: Promise<void> | null = null;

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
    if (this.startPromise) return this.startPromise;

    const attempt = this.startSubscriber(onEvent);
    this.startPromise = attempt;
    try {
      await attempt;
    } finally {
      if (this.startPromise === attempt) {
        this.startPromise = null;
      }
    }
  }

  private async startSubscriber(onEvent: (msg: DraftRealtimeEnvelope) => void): Promise<void> {
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
        if (typeof _channel !== 'string' || !_channel.startsWith(`${prefix}:`)) {
          logger.warn('Received realtime message from an invalid channel', {
            channelType: typeof _channel,
          });
          return;
        }
        if (typeof message !== 'string') {
          logger.warn('Received non-string message from Redis', { messageType: typeof message });
          return;
        }
        const expectedDraftId = _channel.slice(prefix.length + 1);
        const data = parseAndValidateEnvelope(message, expectedDraftId);
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

      this.started = true;
      logger.info('DraftPubSub subscriber started', { pattern: `${prefix}:*` });
    } catch (e) {
      this.started = false;
      logger.error('Failed to start DraftPubSub subscriber', {
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  async publish(draftId: string, event: DraftRealtimeEventType, payload: unknown): Promise<void> {
    if (isNextProductionBuild()) return;

    const envelope: DraftRealtimeEnvelopeV1 = {
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

  async publishV2(message: DraftRealtimeV2EventEnvelope): Promise<void> {
    if (isNextProductionBuild()) return;

    const envelope: DraftRealtimePubSubEnvelopeV2 = {
      v: 2,
      message: DraftRealtimeV2EventEnvelopeSchema.parse(message),
      instanceId: INSTANCE_ID,
      publishedAt: Date.now(),
    };

    try {
      await this.getPublisher().publish(channelForDraft(message.draftId), JSON.stringify(envelope));
    } catch (error) {
      logger.error('Failed to publish sequenced draft realtime event', {
        event: message.event,
        eventId: message.eventId,
        draftId: message.draftId,
        sequence: message.sequence,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

export const draftPubSub = new DraftPubSub();
