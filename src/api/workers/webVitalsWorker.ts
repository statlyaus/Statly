/* eslint-disable no-console */
import { Worker, Job } from 'bullmq';
import { URL } from 'node:url';

type WebVitalsPayload = {
  sessionId: string;
  name: string;          // e.g., "CLS" | "FID" | "LCP" | custom metric
  value: number;
  rating?: 'good' | 'needs-improvement' | 'poor';
  url?: string;
  ua?: string;
  at: string;            // ISO timestamp
};

const QUEUE_NAME = 'web-vitals';

/**
 * Build a BullMQ/ioredis connection object from REDIS_URL.
 * Ensures BullMQ-required flags (maxRetriesPerRequest: null).
 */
function redisConnFromEnv() {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const dbStr = url.pathname.replace('/', '');
  return {
    host: url.hostname,
    port: Number(url.port || '6379'),
    username: url.username || undefined,
    password: url.password || undefined,
    db: dbStr ? Number(dbStr) : 0,
    // BullMQ requirements / common dev flags:
    maxRetriesPerRequest: null as null,
    enableReadyCheck: false,
  };
}

/**
 * Your metric processor — replace with real persistence later.
 * For now, we just log the payload in a structured way.
 */
async function processWebVital(job: Job<WebVitalsPayload>) {
  const { sessionId, name, value, rating, url, ua, at } = job.data;
  console.log(
    JSON.stringify({
      lvl: 'info',
      msg: 'web-vital',
      q: QUEUE_NAME,
      id: job.id,
      sessionId,
      name,
      value,
      rating,
      url,
      ua,
      at,
      ts: new Date().toISOString(),
    })
  );
  // TODO: write to DB/analytics backend here
  return { ok: true };
}

export function createWebVitalsWorker() {
  const worker = new Worker<WebVitalsPayload>(QUEUE_NAME, processWebVital, {
    connection: redisConnFromEnv(),
    // You can tune concurrency if needed (default is #cores)
    // concurrency: 5,
  });

  worker.on('ready', () => {
    console.log(`[worker] ${QUEUE_NAME} ready (pid=${process.pid})`);
  });
  worker.on('error', (err) => {
    console.error('[worker] error', err);
  });
  worker.on('failed', (job, err) => {
    console.error('[worker] job failed', { id: job?.id, err });
  });
  worker.on('completed', (job) => {
    console.log('[worker] job completed', { id: job.id });
  });

  // Simple heartbeat so you know it's alive in dev
  const interval = setInterval(() => {
    console.log(JSON.stringify({ lvl: 'debug', msg: 'heartbeat', q: QUEUE_NAME, ts: new Date().toISOString() }));
  }, 10_000);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[worker] received ${signal}, draining...`);
    clearInterval(interval);
    try {
      await worker.close(); // wait for current job to finish
    } catch (e) {
      console.error('[worker] close error', e);
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  return worker;
}

// Auto-start when invoked via `tsx src/api/workers/webVitalsWorker.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  createWebVitalsWorker();
}
