import { beforeEach, describe, expect, it, vi } from 'vitest';

const { draftRepository, draftAuthorizedReadService } = vi.hoisted(() => ({
  draftRepository: {
    transaction: vi.fn(),
    getDraftEventReplayWindow: vi.fn(),
  },
  draftAuthorizedReadService: {
    authorizeMember: vi.fn(),
  },
}));

vi.mock('@/server/draft/repository/DraftRepository', () => ({ draftRepository }));
vi.mock('@/server/draft/services/DraftAuthorizedReadService', () => ({
  draftAuthorizedReadService,
}));
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { DraftRealtimeReplayService } from '@/server/draft/services/DraftRealtimeReplayService';

function lifecycleEvent(sequence: number, event: 'draft:started' | 'draft:paused') {
  const paused = event === 'draft:paused';
  const occurredAt = new Date(`2026-08-01T00:00:0${sequence}.000Z`);

  return {
    id: `event-${sequence}`,
    draftId: 'draft-1',
    leagueId: 'league-1',
    event,
    payload: {
      status: paused ? 'PAUSED' : 'LIVE',
      schedulingVersion: sequence,
      durationSeconds: 120,
      serverNow: occurredAt.toISOString(),
      pickStartedAt: paused ? null : occurredAt.toISOString(),
      pickDeadlineAt: paused ? null : new Date(occurredAt.getTime() + 120_000).toISOString(),
      pausedRemainingSeconds: paused ? 90 : null,
    },
    publishState: true,
    sequence,
    clockRevision: sequence,
    attempts: 0,
    lastError: null,
    lockedAt: null,
    lockedBy: null,
    publishedAt: occurredAt,
    createdAt: occurredAt,
  } as const;
}

describe('DraftRealtimeReplayService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    draftRepository.transaction.mockImplementation((work) => work({}));
    draftAuthorizedReadService.authorizeMember.mockResolvedValue(undefined);
  });

  it('pages contiguously toward a fixed head while newer events remain outside the window', async () => {
    draftRepository.getDraftEventReplayWindow
      .mockResolvedValueOnce({
        leagueId: 'league-1',
        currentHeadSequence: 2,
        throughSequence: 2,
        events: [lifecycleEvent(1, 'draft:started'), lifecycleEvent(2, 'draft:paused')],
      })
      .mockResolvedValueOnce({
        leagueId: 'league-1',
        currentHeadSequence: 3,
        throughSequence: 2,
        events: [lifecycleEvent(2, 'draft:paused')],
      });

    const service = new DraftRealtimeReplayService();
    const first = await service.replayForMember({
      draftId: 'draft-1',
      authenticatedUserId: 'user-1',
      afterSequence: 0,
      limit: 1,
    });
    const second = await service.replayForMember({
      draftId: 'draft-1',
      authenticatedUserId: 'user-1',
      afterSequence: 1,
      throughSequence: 2,
      limit: 1,
    });

    expect(first).toMatchObject({
      status: 'ready',
      throughSequence: 2,
      nextAfterSequence: 1,
      hasMore: true,
      events: [{ sequence: 1 }],
    });
    expect(second).toMatchObject({
      status: 'ready',
      throughSequence: 2,
      nextAfterSequence: 2,
      hasMore: false,
      events: [{ sequence: 2 }],
    });
    expect(draftAuthorizedReadService.authorizeMember).toHaveBeenCalledTimes(2);
    expect(draftAuthorizedReadService.authorizeMember.mock.invocationCallOrder[0]).toBeLessThan(
      draftRepository.getDraftEventReplayWindow.mock.invocationCallOrder[0]
    );
  });

  it('requires resynchronization for a missing first sequence', async () => {
    draftRepository.getDraftEventReplayWindow.mockResolvedValue({
      leagueId: 'league-1',
      currentHeadSequence: 2,
      throughSequence: 2,
      events: [lifecycleEvent(2, 'draft:paused')],
    });

    const result = await new DraftRealtimeReplayService().replayForMember({
      draftId: 'draft-1',
      authenticatedUserId: 'user-1',
      afterSequence: 0,
    });

    expect(result).toMatchObject({ status: 'resync-required', reason: 'sequence-gap' });
  });

  it('requires resynchronization when a private event consumes the public stream', async () => {
    draftRepository.getDraftEventReplayWindow.mockResolvedValue({
      leagueId: 'league-1',
      currentHeadSequence: 1,
      throughSequence: 1,
      events: [{ ...lifecycleEvent(1, 'draft:started'), event: 'draft:queue-updated' }],
    });

    const result = await new DraftRealtimeReplayService().replayForMember({
      draftId: 'draft-1',
      authenticatedUserId: 'user-1',
      afterSequence: 0,
    });

    expect(result).toMatchObject({ status: 'resync-required', reason: 'invalid-event' });
  });

  it('rejects a cursor beyond the durable stream head', async () => {
    draftRepository.getDraftEventReplayWindow.mockResolvedValue({
      leagueId: 'league-1',
      currentHeadSequence: 3,
      throughSequence: 3,
      events: [],
    });

    const result = await new DraftRealtimeReplayService().replayForMember({
      draftId: 'draft-1',
      authenticatedUserId: 'user-1',
      afterSequence: 4,
    });

    expect(result).toMatchObject({ status: 'resync-required', reason: 'cursor-ahead' });
  });
});
