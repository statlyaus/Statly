import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  draftRepository,
  draftExpiryReconciler,
  draftRealtimeDispatcher,
  draftProjectionService,
  revalidateTags,
  publishLeagueSystemMessage,
} = vi.hoisted(() => ({
  draftRepository: {
    transaction: vi.fn(),
    releaseStaleDraftEventClaims: vi.fn(),
    listPendingDraftEventsBatch: vi.fn(),
    claimDraftEvents: vi.fn(),
    listClaimedDraftEvents: vi.fn(),
    markDraftEventsPublished: vi.fn(),
    markDraftEventsFailed: vi.fn(),
  },
  draftRealtimeDispatcher: {
    publishDraftEvent: vi.fn(),
    publishState: vi.fn(),
  },
  draftExpiryReconciler: {
    reconcileDraft: vi.fn(),
  },
  draftProjectionService: {
    buildAuthoritativeDraftState: vi.fn(),
  },
  revalidateTags: vi.fn(),
  publishLeagueSystemMessage: vi.fn(),
}));

vi.mock('@/lib/cache', () => ({
  revalidateTags,
}));

vi.mock('@/lib/cacheTags', () => ({
  tags: {
    draft: (id: string) => `draft:${id}`,
    league: (id: string) => `league:${id}`,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/server/draft/repository/DraftRepository', () => ({
  draftRepository,
}));

vi.mock('@/server/draft/services/DraftRealtimeDispatcher', () => ({
  draftRealtimeDispatcher,
}));

vi.mock('@/server/draft/services/DraftExpiryReconciler', () => ({
  draftExpiryReconciler,
}));

vi.mock('@/server/draft/services/DraftProjectionService', () => ({
  draftProjectionService,
}));

vi.mock('@/server/leagues/social/socialSystemEvents', () => ({
  publishLeagueSystemMessage,
}));

import { DraftRealtimePublisher } from '@/server/draft/services/DraftRealtimePublisher';

describe('DraftRealtimePublisher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    draftRepository.transaction.mockImplementation((work) => work({}));
    draftExpiryReconciler.reconcileDraft.mockResolvedValue({
      scheduledCount: 1,
      repairedCount: 0,
      skippedCount: 0,
    });
    revalidateTags.mockResolvedValue(undefined);
    publishLeagueSystemMessage.mockResolvedValue({});
  });

  it('drains the events claimed by batch flush instead of re-querying unlocked draft events', async () => {
    const events = [
      {
        id: 'event-1',
        draftId: 'draft-1',
        leagueId: 'league-1',
        event: 'draft:paused',
        payload: null,
        publishState: false,
        attempts: 0,
        lastError: null,
        lockedAt: null,
        lockedBy: null,
        publishedAt: null,
        createdAt: new Date('2026-06-05T00:00:00.000Z'),
      },
      {
        id: 'event-2',
        draftId: 'draft-2',
        leagueId: 'league-2',
        event: 'draft:completed',
        payload: null,
        publishState: false,
        attempts: 0,
        lastError: null,
        lockedAt: null,
        lockedBy: null,
        publishedAt: null,
        createdAt: new Date('2026-06-05T00:00:01.000Z'),
      },
    ] as any;

    draftRepository.listPendingDraftEventsBatch.mockResolvedValue(events);
    draftRepository.claimDraftEvents.mockResolvedValue(events.length);
    draftRepository.listClaimedDraftEvents.mockResolvedValue(events);

    const publisher = new DraftRealtimePublisher();
    const flushedCount = await publisher.flushPendingDraftEventsBatch(50);

    expect(flushedCount).toBe(2);
    expect(draftRealtimeDispatcher.publishDraftEvent).toHaveBeenCalledWith(
      'draft-1',
      'draft:paused',
      undefined
    );
    expect(draftRealtimeDispatcher.publishDraftEvent).toHaveBeenCalledWith(
      'draft-2',
      'draft:completed'
    );
    expect(draftRepository.markDraftEventsPublished).toHaveBeenCalledWith({}, [
      'event-1',
      'event-2',
    ]);
    expect(draftRepository.markDraftEventsFailed).not.toHaveBeenCalled();
  });

  it('keeps a draft event retryable until its social activity is durably created', async () => {
    const event = {
      id: 'event-pick',
      draftId: 'draft-1',
      leagueId: 'league-1',
      event: 'draft:pick-made',
      payload: {
        id: 'pick-1',
        overall: 1,
        member: { displayName: 'Alex' },
        player: { name: 'Taylor' },
      },
      publishState: false,
      attempts: 0,
      lastError: null,
      lockedAt: null,
      lockedBy: null,
      publishedAt: null,
      createdAt: new Date('2026-06-05T00:00:00.000Z'),
    } as any;
    draftRepository.listPendingDraftEventsBatch.mockResolvedValue([event]);
    draftRepository.claimDraftEvents.mockResolvedValue(1);
    draftRepository.listClaimedDraftEvents.mockResolvedValue([event]);
    publishLeagueSystemMessage.mockRejectedValueOnce(new Error('social write unavailable'));

    const publisher = new DraftRealtimePublisher();
    await expect(publisher.flushPendingDraftEventsBatch(50)).rejects.toThrow(
      'social write unavailable'
    );

    expect(draftRepository.markDraftEventsPublished).not.toHaveBeenCalled();
    expect(draftRepository.markDraftEventsFailed).toHaveBeenCalledWith(
      {},
      ['event-pick'],
      'social write unavailable'
    );
  });

  it('forwards the persisted lifecycle clock through an outbox replay', async () => {
    const lifecyclePayload = {
      status: 'PAUSED',
      schedulingVersion: 9,
      durationSeconds: 120,
      serverNow: '2026-06-05T00:00:23.000Z',
      pickStartedAt: null,
      pickDeadlineAt: null,
      pausedRemainingSeconds: 37,
    } as const;
    const event = {
      id: 'event-pause',
      draftId: 'draft-1',
      leagueId: 'league-1',
      event: 'draft:paused',
      payload: lifecyclePayload,
      publishState: true,
      attempts: 0,
      lastError: null,
      lockedAt: null,
      lockedBy: null,
      publishedAt: null,
      createdAt: new Date('2026-06-05T00:00:23.000Z'),
    } as any;

    draftRepository.listPendingDraftEventsBatch.mockResolvedValue([event]);
    draftRepository.claimDraftEvents.mockResolvedValue(1);
    draftRepository.listClaimedDraftEvents.mockResolvedValue([event]);
    draftProjectionService.buildAuthoritativeDraftState.mockResolvedValue({
      draftId: 'draft-1',
    });

    const publisher = new DraftRealtimePublisher();
    await expect(publisher.flushPendingDraftEventsBatch(1)).resolves.toBe(1);

    expect(draftRealtimeDispatcher.publishDraftEvent).toHaveBeenCalledWith(
      'draft-1',
      'draft:paused',
      lifecyclePayload
    );
    expect(draftExpiryReconciler.reconcileDraft).toHaveBeenCalledWith('draft-1');
    expect(draftRepository.markDraftEventsPublished).toHaveBeenCalledWith({}, ['event-pause']);
  });

  it('leaves outbox work retryable when expiry reconciliation is temporarily unavailable', async () => {
    const event = {
      id: 'event-resume',
      draftId: 'draft-1',
      leagueId: 'league-1',
      event: 'draft:resumed',
      payload: null,
      publishState: true,
      attempts: 0,
      lastError: null,
      lockedAt: null,
      lockedBy: null,
      publishedAt: null,
      createdAt: new Date('2026-06-05T00:00:23.000Z'),
    } as any;
    draftRepository.listPendingDraftEventsBatch.mockResolvedValue([event]);
    draftRepository.claimDraftEvents.mockResolvedValue(1);
    draftRepository.listClaimedDraftEvents.mockResolvedValue([event]);
    draftProjectionService.buildAuthoritativeDraftState.mockResolvedValue({
      draftId: 'draft-1',
    });
    draftExpiryReconciler.reconcileDraft.mockRejectedValueOnce(new Error('redis unavailable'));

    const publisher = new DraftRealtimePublisher();
    await expect(publisher.flushPendingDraftEventsBatch(1)).rejects.toThrow('redis unavailable');

    expect(draftRepository.markDraftEventsPublished).not.toHaveBeenCalled();
    expect(draftRepository.markDraftEventsFailed).toHaveBeenCalledWith(
      {},
      ['event-resume'],
      'redis unavailable'
    );
  });
});
