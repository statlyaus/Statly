import { beforeEach, describe, expect, it, vi } from 'vitest';

const { draftRepository, draftScheduler, logger, redis } = vi.hoisted(() => ({
  draftRepository: {
    transaction: vi.fn(),
    listLiveDraftPickExpirySchedules: vi.fn(),
    repairMissingLiveDraftPickDeadline: vi.fn(),
  },
  draftScheduler: {
    schedulePickExpiry: vi.fn(),
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
  draftRepository,
}));

vi.mock('@/server/draft/services/DraftScheduler', () => ({
  draftScheduler,
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
    draftRepository.transaction.mockImplementation((work) => work({}));
    draftRepository.repairMissingLiveDraftPickDeadline.mockResolvedValue({ count: 1 });
    redis.set.mockResolvedValue('OK');
    redis.eval.mockResolvedValue(1);
  });

  it('reschedules every live draft pick deadline from the authoritative draft table', async () => {
    const schedules = [
      {
        draftId: 'draft-expired',
        leagueId: 'league-1',
        schedulingVersion: 7,
        pickDeadlineAt: new Date('2026-06-14T10:00:00.000Z'),
      },
      {
        draftId: 'draft-future',
        leagueId: 'league-2',
        schedulingVersion: 3,
        pickDeadlineAt: new Date('2026-06-14T10:02:00.000Z'),
      },
    ];
    draftRepository.listLiveDraftPickExpirySchedules.mockResolvedValue(schedules);

    await expect(reconcileLiveDraftPickExpiryJobs()).resolves.toBe(2);

    expect(draftRepository.transaction).toHaveBeenCalledTimes(1);
    expect(draftRepository.listLiveDraftPickExpirySchedules).toHaveBeenCalledWith({});
    expect(draftScheduler.schedulePickExpiry).toHaveBeenCalledTimes(2);
    expect(draftScheduler.schedulePickExpiry).toHaveBeenNthCalledWith(1, schedules[0]);
    expect(draftScheduler.schedulePickExpiry).toHaveBeenNthCalledWith(2, schedules[1]);

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

  it('repairs live drafts with missing deadlines before scheduling expiry', async () => {
    const schedule = {
      draftId: 'draft-missing-deadline',
      leagueId: 'league-1',
      schedulingVersion: 4,
      pickDeadlineAt: null,
      pickStartedAt: new Date('2026-06-14T10:00:00.000Z'),
      startedAt: new Date('2026-06-14T09:55:00.000Z'),
      pickSeconds: 60,
    };
    draftRepository.listLiveDraftPickExpirySchedules.mockResolvedValue([schedule]);

    await expect(reconcileLiveDraftPickExpiryJobs()).resolves.toBe(1);

    expect(draftRepository.transaction).toHaveBeenCalledTimes(2);
    expect(draftRepository.repairMissingLiveDraftPickDeadline).toHaveBeenCalledWith(
      {},
      {
        draftId: 'draft-missing-deadline',
        currentSchedulingVersion: 4,
        pickStartedAt: new Date('2026-06-14T10:00:00.000Z'),
        pickDeadlineAt: new Date('2026-06-14T10:01:00.000Z'),
      }
    );
    expect(draftScheduler.schedulePickExpiry).toHaveBeenCalledWith({
      draftId: 'draft-missing-deadline',
      leagueId: 'league-1',
      schedulingVersion: 5,
      pickDeadlineAt: new Date('2026-06-14T10:01:00.000Z'),
    });
  });

  it('skips reconciliation when another worker owns the lease', async () => {
    redis.set.mockResolvedValue(null);

    await expect(reconcileLiveDraftPickExpiryJobs()).resolves.toBe(0);

    expect(draftRepository.transaction).not.toHaveBeenCalled();
    expect(draftScheduler.schedulePickExpiry).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'Skipped live draft timer reconciliation because another worker owns the lease',
      { lockKey: 'draft:worker:reconcile-pick-expiry' }
    );
  });

  it('releases the lease when reconciliation fails', async () => {
    draftRepository.transaction.mockRejectedValue(new Error('database unavailable'));

    await expect(reconcileLiveDraftPickExpiryJobs()).rejects.toThrow('database unavailable');

    expect(redis.eval).toHaveBeenCalledOnce();
  });

  it('accepts a bounded TTL override for larger reconciliation workloads', async () => {
    process.env.DRAFT_RECONCILIATION_LOCK_TTL_MS = '600000';
    draftRepository.listLiveDraftPickExpirySchedules.mockResolvedValue([]);

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
