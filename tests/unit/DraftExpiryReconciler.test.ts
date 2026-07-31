import { beforeEach, describe, expect, it, vi } from 'vitest';

const { draftRepository, draftScheduler } = vi.hoisted(() => ({
  draftRepository: {
    transaction: vi.fn(),
    getLiveDraftPickExpirySchedule: vi.fn(),
    listLiveDraftPickExpirySchedules: vi.fn(),
    repairMissingLiveDraftPickDeadline: vi.fn(),
  },
  draftScheduler: {
    schedulePickExpiry: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/server/draft/repository/DraftRepository', () => ({ draftRepository }));
vi.mock('@/server/draft/services/DraftScheduler', () => ({ draftScheduler }));

import { DraftExpiryReconciler } from '@/server/draft/services/DraftExpiryReconciler';

describe('DraftExpiryReconciler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    draftRepository.transaction.mockImplementation((work) => work({}));
    draftRepository.repairMissingLiveDraftPickDeadline.mockResolvedValue({ count: 1 });
    draftScheduler.schedulePickExpiry.mockResolvedValue(undefined);
  });

  it('derives the job revision and deadline from current Prisma state', async () => {
    const schedule = {
      draftId: 'draft-1',
      leagueId: 'league-1',
      schedulingVersion: 9,
      pickStartedAt: new Date('2026-06-14T10:00:00.000Z'),
      pickDeadlineAt: new Date('2026-06-14T10:02:00.000Z'),
      startedAt: new Date('2026-06-14T10:00:00.000Z'),
      pickSeconds: 120,
    };
    draftRepository.getLiveDraftPickExpirySchedule.mockResolvedValue(schedule);

    await expect(new DraftExpiryReconciler().reconcileDraft('draft-1')).resolves.toEqual({
      scheduledCount: 1,
      repairedCount: 0,
      skippedCount: 0,
    });

    expect(draftScheduler.schedulePickExpiry).toHaveBeenCalledWith({
      draftId: 'draft-1',
      leagueId: 'league-1',
      schedulingVersion: 9,
      pickDeadlineAt: new Date('2026-06-14T10:02:00.000Z'),
    });
  });

  it('does not recreate a timer when the latest persisted state is not live', async () => {
    draftRepository.getLiveDraftPickExpirySchedule.mockResolvedValue(null);

    await expect(new DraftExpiryReconciler().reconcileDraft('draft-1')).resolves.toEqual({
      scheduledCount: 0,
      repairedCount: 0,
      skippedCount: 1,
    });

    expect(draftScheduler.schedulePickExpiry).not.toHaveBeenCalled();
  });

  it('repairs a missing deadline with a new revision before scheduling', async () => {
    draftRepository.getLiveDraftPickExpirySchedule.mockResolvedValue({
      draftId: 'draft-1',
      leagueId: 'league-1',
      schedulingVersion: 4,
      pickStartedAt: new Date('2026-06-14T10:00:00.000Z'),
      pickDeadlineAt: null,
      startedAt: new Date('2026-06-14T09:55:00.000Z'),
      pickSeconds: 60,
    });

    await expect(new DraftExpiryReconciler().reconcileDraft('draft-1')).resolves.toEqual({
      scheduledCount: 0,
      repairedCount: 1,
      skippedCount: 0,
    });

    expect(draftRepository.repairMissingLiveDraftPickDeadline).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        draftId: 'draft-1',
        currentSchedulingVersion: 4,
        pickDeadlineAt: new Date('2026-06-14T10:01:00.000Z'),
      })
    );
    expect(draftScheduler.schedulePickExpiry).toHaveBeenCalledWith(
      expect.objectContaining({ schedulingVersion: 5 })
    );
  });
});
