import { beforeEach, describe, expect, it, vi } from 'vitest';

const { draftClockCoordinator, draftRepository } = vi.hoisted(() => ({
  draftClockCoordinator: {
    ensureReady: vi.fn(),
  },
  draftRepository: {
    transaction: vi.fn(),
    listLiveDraftPickExpirySchedules: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));
vi.mock('@/server/draft/repository/DraftRepository', () => ({ draftRepository }));
vi.mock('@/server/draft/services/DraftClockCoordinator', () => ({
  draftClockCoordinator,
}));

import { DraftExpiryReconciler } from '@/server/draft/services/DraftExpiryReconciler';

const receipt = { jobId: 'draft-pick-expiry:draft-1:9' };

describe('DraftExpiryReconciler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    draftRepository.transaction.mockImplementation((work) => work({}));
  });

  it('schedules the exact deadline and revision returned by durable convergence', async () => {
    draftClockCoordinator.ensureReady.mockResolvedValue({ receipt, repaired: false });

    await expect(new DraftExpiryReconciler().reconcileDraft('draft-1')).resolves.toEqual({
      scheduledCount: 1,
      repairedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    });
    expect(draftClockCoordinator.ensureReady).toHaveBeenCalledWith('draft-1');
  });

  it('does not recreate a timer when convergence finds no current LIVE state', async () => {
    draftClockCoordinator.ensureReady.mockResolvedValue({ receipt: null, repaired: false });

    await expect(new DraftExpiryReconciler().reconcileDraft('draft-1')).resolves.toEqual({
      scheduledCount: 0,
      repairedCount: 0,
      skippedCount: 1,
      failedCount: 0,
    });
    expect(draftClockCoordinator.ensureReady).toHaveBeenCalledWith('draft-1');
  });

  it('reports a durable repair only after scheduling its reloaded winning revision', async () => {
    draftClockCoordinator.ensureReady.mockResolvedValue({ receipt, repaired: true });

    await expect(new DraftExpiryReconciler().reconcileDraft('draft-1')).resolves.toEqual({
      scheduledCount: 0,
      repairedCount: 1,
      skippedCount: 0,
      failedCount: 0,
    });
    expect(draftClockCoordinator.ensureReady).toHaveBeenCalledWith('draft-1');
  });

  it('surfaces scheduler failure after durable convergence without attempting another repair', async () => {
    draftClockCoordinator.ensureReady.mockRejectedValue(new Error('redis unavailable'));

    await expect(new DraftExpiryReconciler().reconcileDraft('draft-1')).rejects.toThrow(
      'redis unavailable'
    );
    expect(draftClockCoordinator.ensureReady).toHaveBeenCalledTimes(1);
  });

  it('keeps sweeping the other live drafts when one draft fails', async () => {
    draftRepository.listLiveDraftPickExpirySchedules.mockResolvedValue([
      { draftId: 'draft-1' },
      { draftId: 'draft-2' },
      { draftId: 'draft-3' },
    ]);
    draftClockCoordinator.ensureReady.mockImplementation(async (draftId: string) => {
      if (draftId === 'draft-2') throw new Error('LIVE draft has invalid pick duration');
      return { receipt, repaired: false };
    });

    await expect(new DraftExpiryReconciler().reconcileAllLiveDrafts()).resolves.toEqual({
      scheduledCount: 2,
      repairedCount: 0,
      skippedCount: 0,
      failedCount: 1,
    });
    expect(draftClockCoordinator.ensureReady).toHaveBeenCalledWith('draft-3');
  });
});
