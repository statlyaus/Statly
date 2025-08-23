import { Worker, QueueEvents, Queue } from 'bullmq';
import type { JobsOptions, Job } from 'bullmq';
import { getWorkerClient, getQueueEventsClient } from '@/api/queues/scalableConnection';
import { logger } from '@/lib/logger';
import type { Redis as IORedisClient, Cluster as IORedisCluster } from 'ioredis';
import { pathToFileURL } from 'node:url';
import { getWebVitalsWriter, createWebVitalsBatcher } from '@/services/webVitalsPersistence';

const QUEUE_NAME = 'web-vitals';

type BullRedisConnection = IORedisClient | IORedisCluster;

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
  jobsOptions?: JobsOptions;
}

export function createWebVitalsWorker(options: StartWorkerOptions = {}) {
  const concurrency = options.concurrency ?? (Number(process.env.METRICS_WORKER_CONCURRENCY) || 5);
  const writer = getWebVitalsWriter();
  const batcher = createWebVitalsBatcher(writer);

  const worker = new Worker<WebVitalJobData>(
    QUEUE_NAME,
    async (job: Job<WebVitalJobData>) => {
      const m = job.data;
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

  // Dead-letter queue for failed jobs
  const dlq = new Queue<WebVitalJobData>('web-vitals-dlq', {
    connection: getWorkerClient() as unknown as BullRedisConnection,
  });

  worker.on('completed', (job) => {
    logger.debug('Web-vitals job completed', { jobId: job.id });
  });

  worker.on('failed', (job, err) => {
    logger.error('Web-vitals job failed', { jobId: job?.id, error: err?.message, stack: err?.stack });
    if (job?.data) {
      void dlq
        .add('failed_metric', job.data, { attempts: 0, removeOnComplete: true, removeOnFail: 100 })
        .catch((e) => logger.error('Failed to enqueue to DLQ', { error: e instanceof Error ? e.message : String(e) }));
    }
  });

  worker.on('stalled', (jobId) => {
    logger.warn('Web-vitals job stalled', { jobId });
  });

  const events = new QueueEvents(QUEUE_NAME, { connection: getQueueEventsClient() as unknown as BullRedisConnection });

  // Evaluate verbosity once, then attach listeners accordingly
  const maybeLogger = logger as unknown as { isLevelEnabled?: (level: string) => boolean };
  const verboseQueueEvents = (typeof maybeLogger.isLevelEnabled === 'function' && maybeLogger.isLevelEnabled('debug'))
    || process.env.WEB_VITALS_EVENTS_VERBOSE === '1'
    || process.env.NODE_ENV !== 'production';

  if (verboseQueueEvents) {
    events.on('waiting', ({ jobId }) => logger.debug('Web-vitals job waiting', { jobId }));
    events.on('active', ({ jobId }) => logger.debug('Web-vitals job active', { jobId }));
  }

  // Always attach completion/failure listeners
  events.on('completed', ({ jobId }) => logger.debug('Web-vitals job completed (events)', { jobId }));
  events.on('failed', ({ jobId, failedReason }) => logger.error('Web-vitals job failed (events)', { jobId, failedReason }));

  // Graceful shutdown: flush batch on signals
  async function shutdown(signal: string) {
    logger.info('Shutting down web-vitals worker', { signal });
    try {
      await batcher.flush();
    } catch (e) {
      logger.error('Failed to flush batch on shutdown', { error: e instanceof Error ? e.message : String(e) });
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
    const meta: unknown = (globalThis as unknown as { importMeta?: unknown }).importMeta ?? (typeof import.meta !== 'undefined' ? import.meta : undefined);
    const esmUrl = (meta && typeof meta === 'object' && 'url' in (meta as Record<string, unknown>)) ? String((meta as Record<string, unknown>).url) : '';
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
