import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { draftExpiryReconciler, draftQueue, redis, workerInstances, queueEventInstances } =
  vi.hoisted(() => ({
    draftExpiryReconciler: {
      reconcileAllLiveDrafts: vi.fn(),
    },
    draftQueue: {
      clean: vi.fn(),
      remove: vi.fn(),
      add: vi.fn(),
    },
    redis: {
      set: vi.fn(),
      eval: vi.fn(),
    },
    workerInstances: [] as Array<Record<string, ReturnType<typeof vi.fn>>>,
    queueEventInstances: [] as Array<Record<string, ReturnType<typeof vi.fn>>>,
  }));

vi.mock('bullmq', () => ({
  Worker: class {
    waitUntilReady = vi.fn().mockResolvedValue(undefined);
    on = vi.fn();
    close = vi.fn().mockResolvedValue(undefined);

    constructor() {
      workerInstances.push(this as unknown as Record<string, ReturnType<typeof vi.fn>>);
    }
  },
  QueueEvents: class {
    waitUntilReady = vi.fn().mockResolvedValue(undefined);
    on = vi.fn();
    close = vi.fn().mockResolvedValue(undefined);

    constructor() {
      queueEventInstances.push(this as unknown as Record<string, ReturnType<typeof vi.fn>>);
    }
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/server/realtime/scalableConnection', () => ({
  getRedisConnection: () => redis,
  ScalableRedisConnection: {
    getInstance: () => ({
      getWorkerClient: vi.fn(),
      getQueueEventsClient: vi.fn(),
    }),
    shutdownInstance: vi.fn(),
  },
}));

vi.mock('@/server/queue/draftQueue', () => ({
  draftQueue,
  getDraftStartJobId: vi.fn(),
}));

vi.mock('@/server/draft/repository/DraftRepository', () => ({
  draftRepository: {},
}));
vi.mock('@/server/draft/services/DraftApplicationService', () => ({
  draftApplicationService: {},
}));
vi.mock('@/server/draft/services/DraftRealtimePublisher', () => ({
  draftRealtimePublisher: {},
}));
vi.mock('@/server/draft/services/DraftExpiryReconciler', () => ({
  draftExpiryReconciler,
}));

import { EnhancedDraftWorker } from '@/server/workers/enhancedDraftWorker';

describe('EnhancedDraftWorker reconciliation lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.env.DRAFT_RECONCILIATION_INTERVAL_MS = '5000';
    redis.set.mockResolvedValue('OK');
    redis.eval.mockResolvedValue(1);
    draftExpiryReconciler.reconcileAllLiveDrafts.mockResolvedValue({
      scheduledCount: 0,
      repairedCount: 0,
      skippedCount: 0,
    });
  });

  afterEach(() => {
    delete process.env.DRAFT_RECONCILIATION_INTERVAL_MS;
    vi.useRealTimers();
  });

  it('reconciles on startup and periodically, then stops reconciliation on shutdown', async () => {
    const worker = new EnhancedDraftWorker('worker-1');

    await worker.start();
    expect(draftExpiryReconciler.reconcileAllLiveDrafts).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(draftExpiryReconciler.reconcileAllLiveDrafts).toHaveBeenCalledTimes(2);

    await worker.shutdown();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(draftExpiryReconciler.reconcileAllLiveDrafts).toHaveBeenCalledTimes(2);
    expect(workerInstances.at(-1)?.close).toHaveBeenCalledOnce();
    expect(queueEventInstances.at(-1)?.close).toHaveBeenCalledOnce();
  });
});
