import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  workers: [] as Array<{ start: ReturnType<typeof vi.fn>; shutdown: ReturnType<typeof vi.fn> }>,
  shutdownInstance: vi.fn(),
}));

vi.mock('@/server/workers/enhancedDraftWorker', () => ({
  EnhancedDraftWorker: class {
    start = vi.fn().mockResolvedValue(undefined);
    shutdown = vi.fn().mockResolvedValue(undefined);

    constructor() {
      mocks.workers.push(this);
    }

    getMetrics() {
      return {
        jobsProcessed: 0,
        jobsFailed: 0,
        averageProcessingTime: 0,
        lastActivity: new Date(),
        ready: true,
      };
    }
  },
}));

vi.mock('@/server/realtime/scalableConnection', () => ({
  ScalableRedisConnection: {
    shutdownInstance: mocks.shutdownInstance,
    getInstance: () => ({ forceHealthCheck: vi.fn().mockResolvedValue({ isHealthy: true }) }),
  },
}));

import { createWorkerPool } from '@/server/workers/workerPool';

describe('worker pool Redis lifecycle ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workers.length = 0;
    mocks.shutdownInstance.mockResolvedValue(undefined);
  });

  it('keeps shared Redis alive when one worker is removed and closes it when the pool stops', async () => {
    const pool = createWorkerPool({ workerCount: 0, gracefulShutdownTimeout: 1_000 });
    const workerId = await pool.addWorker();

    await expect(pool.removeWorker(workerId)).resolves.toBe(true);
    expect(mocks.workers[0]?.shutdown).toHaveBeenCalledOnce();
    expect(mocks.shutdownInstance).not.toHaveBeenCalled();

    await pool.stop();
    expect(mocks.shutdownInstance).toHaveBeenCalledOnce();
  });

  it('keeps singleton teardown out of an individual worker shutdown', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/server/workers/enhancedDraftWorker.ts'),
      'utf8'
    );
    const workerShutdown = source.slice(
      source.indexOf('public async shutdown(): Promise<void>'),
      source.indexOf('function isDirectWorkerEntrypoint')
    );

    expect(workerShutdown).not.toContain('ScalableRedisConnection.shutdownInstance()');
    expect(source.slice(source.indexOf('async function shutdownDirectWorker'))).toContain(
      'ScalableRedisConnection.shutdownInstance()'
    );
  });
});
