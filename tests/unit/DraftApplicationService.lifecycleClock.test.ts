import { DraftDirection, DraftStatus } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { draftRepository } = vi.hoisted(() => ({
  draftRepository: {
    transaction: vi.fn(),
    getDraftAggregate: vi.fn(),
    updateDraftStatus: vi.fn(),
    updateDraftTiming: vi.fn(),
    createDraftEvents: vi.fn(),
  },
}));

vi.mock('@/server/draft/repository/DraftRepository', () => ({ draftRepository }));
vi.mock('@/server/rosters/RosterProjectionService', () => ({
  RosterProjectionService: class {
    projectDraft = vi.fn();
  },
}));

import { DraftApplicationService } from '@/server/draft/services/DraftApplicationService';

function aggregate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'draft-1',
    leagueId: 'league-1',
    status: DraftStatus.LIVE,
    currentPick: 1,
    totalPicks: 2,
    round: 1,
    direction: DraftDirection.FORWARD,
    startedAt: new Date('2026-06-07T00:00:00.000Z'),
    completedAt: null,
    pickStartedAt: new Date('2026-06-07T00:00:00.000Z'),
    pickDeadlineAt: new Date('2026-06-07T00:01:07.000Z'),
    pausedRemainingSeconds: null,
    schedulingVersion: 4,
    settings: {
      rosterSize: 1,
      benchSize: 0,
      pickSeconds: 120,
      allowAutoPick: true,
      selectedCategories: ['goals'],
      positionLimits: {},
      autoPickRules: {},
      draftType: 'SNAKE',
    },
    participants: [
      {
        memberId: 'member-1',
        userId: 'owner-1',
        slot: 1,
        displayName: 'Owner',
        role: 'OWNER',
      },
    ],
    picks: [],
    ...overrides,
  };
}

describe('DraftApplicationService lifecycle clock outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-07T00:00:30.000Z'));
    draftRepository.transaction.mockImplementation((work) => work({}));
    draftRepository.updateDraftStatus.mockResolvedValue({ count: 1 });
    draftRepository.updateDraftTiming.mockResolvedValue({ count: 1 });
    draftRepository.createDraftEvents.mockImplementation(async (_tx, events) =>
      events.map((event: Record<string, unknown>, index: number) => ({
        id: `event-${index + 1}`,
        ...event,
      }))
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists the exact paused remainder and next scheduling revision', async () => {
    draftRepository.getDraftAggregate.mockResolvedValue(aggregate());
    draftRepository.updateDraftStatus.mockImplementation(async () => {
      vi.advanceTimersByTime(5_000);
      return { count: 1 };
    });
    const service = new DraftApplicationService();

    const result = await service.pauseDraft({ draftId: 'draft-1', actorUserId: 'owner-1' });

    expect(result.data).toMatchObject({
      status: DraftStatus.PAUSED,
      pausedAt: '2026-06-07T00:00:30.000Z',
      pausedRemainingSeconds: 37,
      schedulingVersion: 5,
    });
    expect(draftRepository.createDraftEvents).toHaveBeenCalledWith({}, [
      expect.objectContaining({
        event: 'draft:paused',
        publishState: true,
        payload: {
          status: DraftStatus.PAUSED,
          schedulingVersion: 5,
          durationSeconds: 120,
          serverNow: '2026-06-07T00:00:30.000Z',
          pickStartedAt: null,
          pickDeadlineAt: null,
          pausedRemainingSeconds: 37,
        },
      }),
    ]);
  });

  it('persists the resumed deadline from the frozen remainder without a Redis dependency', async () => {
    draftRepository.getDraftAggregate.mockResolvedValue(
      aggregate({
        status: DraftStatus.PAUSED,
        pickStartedAt: null,
        pickDeadlineAt: null,
        pausedRemainingSeconds: 37,
        schedulingVersion: 5,
      })
    );
    const service = new DraftApplicationService();

    const result = await service.resumeDraft({ draftId: 'draft-1', actorUserId: 'owner-1' });

    expect(result.data).toMatchObject({
      status: DraftStatus.LIVE,
      resumedAt: '2026-06-07T00:00:30.000Z',
      pickDeadlineAt: '2026-06-07T00:01:07.000Z',
      schedulingVersion: 6,
    });
    expect(draftRepository.createDraftEvents).toHaveBeenCalledWith({}, [
      expect.objectContaining({
        event: 'draft:resumed',
        publishState: true,
        payload: {
          status: DraftStatus.LIVE,
          schedulingVersion: 6,
          durationSeconds: 120,
          serverNow: '2026-06-07T00:00:30.000Z',
          pickStartedAt: '2026-06-07T00:00:30.000Z',
          pickDeadlineAt: '2026-06-07T00:01:07.000Z',
          pausedRemainingSeconds: null,
        },
      }),
    ]);
  });
});
