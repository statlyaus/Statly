import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  draftRepository,
  draftClockCoordinator,
  draftRealtimeDispatcher,
  draftProjectionService,
  revalidateTags,
  publishLeagueSystemMessage,
  incCounter,
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
    publishV2Event: vi.fn(),
  },
  draftClockCoordinator: {
    ensureReady: vi.fn(),
  },
  draftProjectionService: {
    buildAuthoritativeDraftState: vi.fn(),
  },
  revalidateTags: vi.fn(),
  publishLeagueSystemMessage: vi.fn(),
  incCounter: vi.fn(),
}));

vi.mock('@/server/metrics', () => ({
  METRICS: {
    draftOutboxFlushes: 'draft_outbox_flushes_total',
    draftOutboxEvents: 'draft_outbox_events_total',
    draftRealtimeStatePreparationRetries: 'draft_realtime_state_preparation_retries_total',
  },
  incCounter,
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

vi.mock('@/server/draft/services/DraftClockCoordinator', () => ({
  draftClockCoordinator,
}));

vi.mock('@/server/draft/services/DraftProjectionService', () => ({
  draftProjectionService,
}));

vi.mock('@/server/leagues/social/socialSystemEvents', () => ({
  publishLeagueSystemMessage,
}));

import { DraftRealtimePublisher } from '@/server/draft/services/DraftRealtimePublisher';

function buildPausedState() {
  const now = new Date('2026-06-05T00:00:23.000Z');

  return {
    leagueId: 'league-1',
    draftId: 'draft-1',
    status: 'PAUSED' as const,
    throughSequence: 1,
    clock: {
      status: 'PAUSED' as const,
      revision: 9,
      durationSeconds: 120,
      serverNow: now.toISOString(),
      remainingSeconds: 37,
    },
    currentPick: {
      userId: 'user-1',
      memberId: 'member-1',
      pickNumber: 3,
      round: 1,
      slot: 1,
      expiresAt: now,
      startedAt: now,
    },
    picks: [],
    participants: [],
    timerSettings: {
      durationSeconds: 120,
      autopickAfterExpiry: true,
      pausedTimeRemaining: 37,
    },
    draftSettings: {
      totalRounds: 22,
      totalTeams: 12,
      draftType: 'SNAKE' as const,
      pickTimeLimit: 120,
    },
    paused: true,
    createdAt: now,
    updatedAt: now,
    lastActivity: now,
  };
}

function buildLiveState() {
  const paused = buildPausedState();
  return {
    ...paused,
    status: 'LIVE' as const,
    clock: {
      status: 'LIVE' as const,
      revision: 9,
      durationSeconds: 120,
      serverNow: paused.clock.serverNow,
      startedAt: '2026-06-05T00:00:00.000Z',
      deadlineAt: '2026-06-05T00:02:00.000Z',
    },
    paused: false,
    timerSettings: {
      ...paused.timerSettings,
      pausedTimeRemaining: null,
    },
  };
}

describe('DraftRealtimePublisher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    draftRepository.transaction.mockImplementation((work) => work({}));
    draftClockCoordinator.ensureReady.mockResolvedValue({ receipt: null, repaired: false });
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
    expect(incCounter).toHaveBeenCalledWith('draft_outbox_flushes_total', 1, {
      source: 'batch',
      outcome: 'success',
    });
    expect(incCounter).toHaveBeenCalledWith('draft_outbox_events_total', 2, {
      outcome: 'published',
    });
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
    expect(incCounter).toHaveBeenCalledWith('draft_outbox_flushes_total', 1, {
      source: 'batch',
      outcome: 'failed',
    });
    expect(incCounter).toHaveBeenCalledWith('draft_outbox_events_total', 1, {
      outcome: 'failed',
    });
    expect(incCounter.mock.invocationCallOrder.at(-1)).toBeLessThan(
      draftRepository.markDraftEventsFailed.mock.invocationCallOrder[0]
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
      sequence: 1,
      clockRevision: 9,
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
    draftProjectionService.buildAuthoritativeDraftState.mockResolvedValue(buildPausedState());

    const publisher = new DraftRealtimePublisher();
    await expect(publisher.flushPendingDraftEventsBatch(1)).resolves.toBe(1);

    expect(draftRealtimeDispatcher.publishDraftEvent).toHaveBeenCalledWith(
      'draft-1',
      'draft:paused',
      lifecyclePayload
    );
    expect(draftClockCoordinator.ensureReady).toHaveBeenCalledWith('draft-1');
    expect(draftClockCoordinator.ensureReady.mock.invocationCallOrder[0]).toBeLessThan(
      draftProjectionService.buildAuthoritativeDraftState.mock.invocationCallOrder[0]
    );
    expect(
      draftProjectionService.buildAuthoritativeDraftState.mock.invocationCallOrder[0]
    ).toBeLessThan(draftRealtimeDispatcher.publishDraftEvent.mock.invocationCallOrder[0]);
    expect(draftRealtimeDispatcher.publishDraftEvent.mock.invocationCallOrder[0]).toBeLessThan(
      draftRealtimeDispatcher.publishV2Event.mock.invocationCallOrder[0]
    );
    expect(draftRealtimeDispatcher.publishV2Event.mock.invocationCallOrder[0]).toBeLessThan(
      draftRealtimeDispatcher.publishState.mock.invocationCallOrder[0]
    );
    expect(draftRealtimeDispatcher.publishV2Event).toHaveBeenCalledWith(
      expect.objectContaining({
        v: 2,
        eventId: 'event-pause',
        draftId: 'draft-1',
        leagueId: 'league-1',
        event: 'draft:paused',
        sequence: 1,
        stateRevision: 9,
      })
    );
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
      sequence: 1,
      clockRevision: 9,
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
    draftClockCoordinator.ensureReady.mockRejectedValueOnce(new Error('redis unavailable'));

    const publisher = new DraftRealtimePublisher();
    await expect(publisher.flushPendingDraftEventsBatch(1)).rejects.toThrow('redis unavailable');

    expect(draftProjectionService.buildAuthoritativeDraftState).not.toHaveBeenCalled();
    expect(draftRealtimeDispatcher.publishDraftEvent).not.toHaveBeenCalled();
    expect(draftRealtimeDispatcher.publishState).not.toHaveBeenCalled();
    expect(draftRepository.markDraftEventsPublished).not.toHaveBeenCalled();
    expect(draftRepository.markDraftEventsFailed).toHaveBeenCalledWith(
      {},
      ['event-resume'],
      'redis unavailable'
    );
  });

  it('counts each concurrent clock transition retry without identity labels', async () => {
    draftClockCoordinator.ensureReady
      .mockResolvedValueOnce({ receipt: { token: { stateRevision: 8 } }, repaired: false })
      .mockResolvedValueOnce({ receipt: { token: { stateRevision: 9 } }, repaired: false });
    draftProjectionService.buildAuthoritativeDraftState.mockResolvedValue(buildLiveState());

    await expect(new DraftRealtimePublisher().publishDraftState('draft-1')).resolves.toMatchObject({
      draftId: 'draft-1',
      status: 'LIVE',
    });

    expect(incCounter).toHaveBeenCalledWith(
      'draft_realtime_state_preparation_retries_total',
      1,
      { reason: 'concurrent_clock_transition' }
    );
    expect(incCounter).toHaveBeenCalledTimes(1);
  });
});
