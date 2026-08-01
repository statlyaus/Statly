import { beforeEach, describe, expect, it, vi } from 'vitest';

const { draftExpiryReconciler, logger, redis } = vi.hoisted(() => ({
  draftExpiryReconciler: {
    reconcileAllLiveDrafts: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  redis: {
    set: vi.fn(),
    eval: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger,
}));

vi.mock('@/server/realtime/scalableConnection', () => ({
  getRedisConnection: () => redis,
  ScalableRedisConnection: {
    getInstance: vi.fn(),
  },
}));

vi.mock('@/server/draft/repository/DraftRepository', () => ({
  draftRepository: {},
}));

vi.mock('@/server/draft/services/DraftExpiryReconciler', () => ({
  draftExpiryReconciler,
}));

vi.mock('@/server/draft/services/DraftApplicationService', () => ({
  draftApplicationService: {
    autoPick: vi.fn(),
    openScheduledLobby: vi.fn(),
    startDraft: vi.fn(),
  },
}));

vi.mock('@/server/draft/services/DraftRealtimePublisher', () => ({
  draftRealtimePublisher: {
    publishCommandResult: vi.fn(),
  },
}));

import { reconcileLiveDraftPickExpiryJobs } from '@/server/workers/enhancedDraftWorker';

describe('enhanced draft worker expiry reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DRAFT_RECONCILIATION_LOCK_TTL_MS;
    draftExpiryReconciler.reconcileAllLiveDrafts.mockResolvedValue({
      scheduledCount: 2,
      repairedCount: 0,
      skippedCount: 0,
    });
    redis.set.mockResolvedValue('OK');
    redis.eval.mockResolvedValue(1);
  });

  it('delegates live clock convergence and scheduling while it owns the lease', async () => {
    await expect(reconcileLiveDraftPickExpiryJobs()).resolves.toBe(2);

    expect(draftExpiryReconciler.reconcileAllLiveDrafts).toHaveBeenCalledOnce();

    const lockToken = redis.set.mock.calls[0][1];
    expect(redis.set).toHaveBeenCalledWith(
      'draft:worker:reconcile-pick-expiry',
      expect.any(String),
      'PX',
      300_000,
      'NX'
    );
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringMatching(/redis\.call\('get'.*redis\.call\('del'/s),
      1,
      'draft:worker:reconcile-pick-expiry',
      lockToken
    );
  });

  it('counts repaired drafts as reconciled work', async () => {
    draftExpiryReconciler.reconcileAllLiveDrafts.mockResolvedValue({
      scheduledCount: 0,
      repairedCount: 1,
      skippedCount: 0,
    });

    await expect(reconcileLiveDraftPickExpiryJobs()).resolves.toBe(1);

    expect(draftExpiryReconciler.reconcileAllLiveDrafts).toHaveBeenCalledOnce();
  });

  it('skips reconciliation when another worker owns the lease', async () => {
    redis.set.mockResolvedValue(null);

    await expect(reconcileLiveDraftPickExpiryJobs()).resolves.toBe(0);

    expect(draftExpiryReconciler.reconcileAllLiveDrafts).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'Skipped live draft timer reconciliation because another worker owns the lease',
      { lockKey: 'draft:worker:reconcile-pick-expiry' }
    );
  });

  it('releases the lease when reconciliation fails', async () => {
    draftExpiryReconciler.reconcileAllLiveDrafts.mockRejectedValue(
      new Error('database unavailable')
    );

    await expect(reconcileLiveDraftPickExpiryJobs()).rejects.toThrow('database unavailable');

    expect(redis.eval).toHaveBeenCalledOnce();
  });

  it('accepts a bounded TTL override for larger reconciliation workloads', async () => {
    process.env.DRAFT_RECONCILIATION_LOCK_TTL_MS = '600000';
    draftExpiryReconciler.reconcileAllLiveDrafts.mockResolvedValue({
      scheduledCount: 0,
      repairedCount: 0,
      skippedCount: 0,
    });

    await reconcileLiveDraftPickExpiryJobs();

    expect(redis.set).toHaveBeenCalledWith(
      'draft:worker:reconcile-pick-expiry',
      expect.any(String),
      'PX',
      600_000,
      'NX'
    );
  });
});
