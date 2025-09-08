import 'server-only';
import '@/lib/loadEnv';
import { pathToFileURL } from 'node:url';

import { Worker, QueueEvents, Queue } from 'bullmq';
import { z } from 'zod';

import { logger } from '@/lib/logger';
import { ScalableRedisConnection } from '@/server/realtime/scalableConnection';
import { getWebVitalsWriter, createWebVitalsBatcher } from '@/services/webVitalsPersistence';

import type { Job } from 'bullmq';
import type { Redis as IORedisClient, Cluster as IORedisCluster } from 'ioredis';


        .add('failed_metric', job.data, {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000
          },
          removeOnComplete: true,
          removeOnFail: 100
        })
  /** Web Vital metric name */
  name: 'CLS' | 'FID' | 'FCP' | 'INP' | 'LCP' | 'TTFB';
  /** Metric value (ms for time-based metrics, unitless for CLS) */
  value: number;
  /** Performance rating based on thresholds */
  rating: 'good' | 'needs-improvement' | 'poor';
  /** Change in value since last measurement */
  delta?: number;
  /** Client-generated unique identifier */
  id: string; // client-generated id
  /** Type of navigation that triggered the metric */
  navigationType?: 'navigate' | 'reload' | 'back_forward' | 'prerender';
  /** User session identifier */
  sessionId: string;
  /** Timestamp in epoch milliseconds */
  timestamp: number; // epoch ms
  /** Sanitized URL (origin + pathname only) */
  url: string; // sanitized origin + pathname
  /** Hashed session ID for privacy-preserving logging */
  sessionIdHash: string; // for logging only
  /** User agent string for client identification */
  userAgent: string;
  const worker = new Worker<WebVitalJobData>(
    QUEUE_NAME,
    async (job: Job<WebVitalJobData>) => {
      const m = job.data;
      try {
        // Add to batch; batcher will flush on interval/size
        await batcher.add({
          name: m.name,
          value: m.value,
          rating: m.rating,
          delta: m.delta,
          id: m.id,
          navigationType: m.navigationType,
          sessionId: m.sessionId,
          timestamp: m.timestamp,
          url: m.url,
          sessionIdHash: m.sessionIdHash,
          userAgent: m.userAgent,
        });
      } catch (error) {
        logger.error('Failed to add metric to batcher', {
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error),
          metric: m.name,
        });
        throw error; // Re-throw to trigger retry logic
      }

      // Also log for observability (non-blocking)
      logger.info('Web-vitals job processed', {
        jobId: job.id,
        name: m.name,
        value: m.value,
        rating: m.rating,
        url: m.url,
        navigationType: m.navigationType,
        sessionIdHash: m.sessionIdHash,
        ts: new Date(m.timestamp).toISOString(),
      });
    },
    {
      connection: getWorkerClient() as unknown as BullRedisConnection,
      concurrency,
    }
  );
    if (rating === 'needs-improvement' && (value <= 800 || value > 1800)) return false;
    if (rating === 'poor' && value <= 1800) return false;
  }
  
  return true;
}, {
  message: 'Invalid name↔rating↔value combination for Web Vital metric'
});

export interface WebVitalJobData {
  name: 'CLS' | 'FID' | 'FCP' | 'INP' | 'LCP' | 'TTFB';
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  delta?: number;
  id: string; // client-generated id
  navigationType?: 'navigate' | 'reload' | 'back_forward' | 'prerender';
  sessionId: string;
  timestamp: number; // epoch ms
  url: string; // sanitized origin + pathname
  sessionIdHash: string; // for logging only
  userAgent: string;
}

export interface StartWorkerOptions {
  concurrency?: number;
}

export function createWebVitalsWorker(options: StartWorkerOptions = {}): { worker: Worker<WebVitalJobData>; events: QueueEvents } {
  const concurrency = options.concurrency ?? (Number(process.env.METRICS_WORKER_CONCURRENCY) || 5);
  const writer = getWebVitalsWriter();
  const batcher = createWebVitalsBatcher(writer);

  const worker = new Worker<WebVitalJobData>(
    QUEUE_NAME,
    async (job: Job<WebVitalJobData>) => {
      const m = job.data;
      
      // Validate job data at worker boundary
      const validationResult = WebVitalJobDataSchema.safeParse(m);
  async function shutdown(signal: string) {
    logger.info('Shutting down web-vitals worker', { signal });
    try {
      // Pause the worker to prevent processing new jobs
      await worker.pause();
      await batcher.flush();
    } catch (e) {
      logger.error('Failed to flush batch on shutdown', {
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      await worker.close();
      await events.close();
      await dlq.close();
      process.exit(0);
    }
  }
      const validatedData = validationResult.data;
      
      // Add to batch; batcher will flush on interval/size
      // Exclude sessionIdHash from persistence payload (use only in logs)
      await batcher.add({
        name: validatedData.name,
        value: validatedData.value,
        rating: validatedData.rating,
        delta: validatedData.delta,
        id: validatedData.id,
        navigationType: validatedData.navigationType,
        sessionId: validatedData.sessionId,
        timestamp: validatedData.timestamp,
        url: validatedData.url,
        userAgent: validatedData.userAgent,
      });

      // Also log for observability (non-blocking)
      logger.info('Web-vitals job processed', {
        jobId: job.id,
        name: validatedData.name,
        value: validatedData.value,
        rating: validatedData.rating,
        url: validatedData.url,
        navigationType: validatedData.navigationType,
        sessionIdHash: validatedData.sessionIdHash,
        ts: new Date(validatedData.timestamp).toISOString(),
      });
    },
    {
      connection: ScalableRedisConnection.getInstance().getWorkerClient() as unknown as BullRedisConnection,
      concurrency,
    }
  );

  // Dead-letter queue for failed jobs
  const dlq = new Queue<WebVitalJobData>(DEAD_LETTER_QUEUE_NAME, {
    connection: ScalableRedisConnection.getInstance().getWorkerClient() as unknown as BullRedisConnection,
  });

  worker.on('completed', (job) => {
    logger.debug('Web-vitals job completed', { jobId: job.id });
  });

  worker.on('failed', (job, err) => {
    logger.error('Web-vitals job failed', {
      jobId: job?.id,
      error: err?.message,
      stack: err?.stack,
    });
    if (job?.data) {
      void dlq
        .add('failed_metric', job.data, { attempts: 0, removeOnComplete: true, removeOnFail: 100 })
        .catch((e) =>
          logger.error('Failed to enqueue to DLQ', {
            error: e instanceof Error ? e.message : String(e),
          })
        );
    }
  });

  worker.on('stalled', (jobId) => {
    logger.warn('Web-vitals job stalled', { jobId });
  });

  const events = new QueueEvents(QUEUE_NAME, {
    connection: ScalableRedisConnection.getInstance().getQueueEventsClient() as unknown as BullRedisConnection,
  });

  // Evaluate verbosity once, then attach listeners accordingly
  const maybeLogger = logger as unknown as { isLevelEnabled?: (level: string) => boolean };
  const verboseQueueEvents =
    (typeof maybeLogger.isLevelEnabled === 'function' && maybeLogger.isLevelEnabled('debug')) ||
    process.env.WEB_VITALS_EVENTS_VERBOSE === '1' ||
    process.env.NODE_ENV !== 'production';

  if (verboseQueueEvents) {
    events.on('waiting', ({ jobId }) => logger.debug('Web-vitals job waiting', { jobId }));
    events.on('active', ({ jobId }) => logger.debug('Web-vitals job active', { jobId }));
  }

  // Always attach completion/failure listeners
  events.on('completed', ({ jobId }) =>
    logger.debug('Web-vitals job completed (events)', { jobId })
  );
  events.on('failed', ({ jobId, failedReason }) =>
    logger.error('Web-vitals job failed (events)', { jobId, failedReason })
  );

  // Graceful shutdown: flush batch on signals
  async function shutdown(signal: string) {
    logger.info('Shutting down web-vitals worker', { signal });
    try {
      await batcher.flush();
    } catch (e) {
      logger.error('Failed to flush batch on shutdown', {
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      await worker.close();
      await events.close();
      await dlq.close();
      process.exit(0);
    }
  }
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info('Web-vitals worker started', { concurrency });
  return { worker, events };
}

// Support both ESM and CJS direct execution
const isDirectRun = (() => {
  try {
    const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
    // Narrow importMeta type safely without any
    const meta: unknown =
      (globalThis as unknown as { importMeta?: unknown }).importMeta ??
      (typeof import.meta !== 'undefined' ? import.meta : undefined);
    const esmUrl =
      meta && typeof meta === 'object' && 'url' in (meta as Record<string, unknown>)
        ? String((meta as Record<string, unknown>).url)
        : '';
    return esmUrl === invoked;
  } catch {
    return false;
  }
})();

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Node CJS guard if transpiled
const isCjsMain = typeof require !== 'undefined' && require.main === module;

if (isDirectRun || isCjsMain) {
  createWebVitalsWorker();
}