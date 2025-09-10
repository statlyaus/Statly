import 'server-only';

import { Worker, QueueEvents } from 'bullmq';
import { z } from 'zod';

import { logger } from '../../lib/logger';
import { getWorkerClient, getQueueEventsClient } from '../realtime/scalableConnection';
import { getWebVitalsWriter, createWebVitalsBatcher } from '../../services/webVitalsPersistence';

export interface WebVitalJobData {
  name: 'CLS' | 'FID' | 'FCP' | 'INP' | 'LCP' | 'TTFB';
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  delta?: number;
  id: string;
  navigationType?: 'navigate' | 'reload' | 'back_forward' | 'prerender';
  sessionId: string;
  timestamp: number;
  url: string;
  sessionIdHash: string;
  userAgent: string;
}

const WebVitalJobDataSchema = z.object({
  name: z.enum(['CLS', 'FID', 'FCP', 'INP', 'LCP', 'TTFB']),
  value: z.number().finite().nonnegative(),
  rating: z.enum(['good', 'needs-improvement', 'poor']),
  delta: z.number().finite().optional(),
  id: z.string().min(1),
  navigationType: z.enum(['navigate', 'reload', 'back_forward', 'prerender']).optional(),
  sessionId: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
  url: z.string().min(1),
  sessionIdHash: z.string().min(1),
  userAgent: z.string().min(1),
});

export function createWebVitalsWorker({ concurrency = Number(process.env.METRICS_WORKER_CONCURRENCY) || 5 } = {}) {
  const writer = getWebVitalsWriter();
  const batcher = createWebVitalsBatcher(writer);

  const worker = new Worker<WebVitalJobData>(
    'web-vitals',
    async (job) => {
      const parsed = WebVitalJobDataSchema.safeParse(job.data);
      if (!parsed.success) {
        logger.warn('Invalid web-vitals job dropped', { jobId: job.id, issues: parsed.error.issues });
        return;
      }
      const m = parsed.data;
      try {
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
          userAgent: m.userAgent,
        });
      } catch (error) {
        logger.error('Failed to persist web-vitals metric', {
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    {
      connection: getWorkerClient() as any,
      concurrency,
    }
  );

  const events = new QueueEvents('web-vitals', {
    connection: getQueueEventsClient() as any,
  });
  events.on('failed', ({ jobId, failedReason }) => {
    logger.error('web-vitals job failed', { jobId, failedReason });
  });
  events.on('completed', ({ jobId }) => {
    logger.debug('web-vitals job completed', { jobId });
  });

  logger.info('WebVitals worker started', { concurrency });
  return { worker, events };
}

export default createWebVitalsWorker;
