import { DraftDirection, DraftStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { draftRepository, draftScheduler } = vi.hoisted(() => ({
  draftRepository: {
    transaction: vi.fn(),
    getDraftAggregate: vi.fn(),
    findQueuedPlayer: vi.fn(),
    findPlayer: vi.fn(),
    findBestAvailablePlayer: vi.fn(),
    createPick: vi.fn(),
    removeQueuedPlayerById: vi.fn(),
    advanceDraft: vi.fn(),
    updateDraftTiming: vi.fn(),
    toEventPick: vi.fn(),
    createDraftEvents: vi.fn(),
    findPickByOverall: vi.fn(),
  },
  draftScheduler: {
    cancelPickExpiry: vi.fn(),
    schedulePickExpiry: vi.fn(),
  },
}));

vi.mock('@/server/draft/repository/DraftRepository', () => ({
  draftRepository,
}));

vi.mock('@/server/draft/services/DraftScheduler', () => ({
  draftScheduler,
}));

vi.mock('@/server/rosters/RosterProjectionService', () => ({
  RosterProjectionService: class {
    projectDraft = vi.fn();
  },
}));

import { DraftApplicationService } from '@/server/draft/services/DraftApplicationService';

describe('DraftApplicationService completion projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    draftRepository.transaction.mockImplementation((work) => work({}));
    draftRepository.findQueuedPlayer.mockResolvedValue(null);
    draftRepository.findBestAvailablePlayer.mockResolvedValue({
      id: 'player-2',
      name: 'Second Player',
      position: 'MID',
      club: 'Sydney',
      active: true,
    });
    draftRepository.createPick.mockResolvedValue({
      id: 'pick-2',
      draftId: 'draft-1',
      overall: 2,
      round: 1,
      slot: 2,
      memberId: 'member-2',
      playerId: 'player-2',
      auto: true,
      player: {
        id: 'player-2',
        name: 'Second Player',
        position: 'MID',
        club: 'Sydney',
      },
      member: {
        user: {
          id: 'bot-user-1',
          displayName: 'CPU Team 1',
          email: 'bot-user-1@statly.local',
        },
      },
    });
    draftRepository.advanceDraft.mockResolvedValue({ count: 1 });
    draftRepository.updateDraftTiming.mockResolvedValue({ count: 1 });
    draftRepository.toEventPick.mockReturnValue({
      id: 'pick-2',
      playerId: 'player-2',
      memberId: 'member-2',
      overall: 2,
    });
    draftRepository.createDraftEvents.mockResolvedValue([{ id: 'event-1' }, { id: 'event-2' }]);
  });

  it('projects canonical roster ownership and cancels pick expiry after the final auto-pick', async () => {
    draftRepository.getDraftAggregate.mockResolvedValue({
      id: 'draft-1',
      leagueId: 'league-1',
      status: DraftStatus.LIVE,
      currentPick: 2,
      totalPicks: 2,
      round: 1,
      direction: DraftDirection.FORWARD,
      startedAt: new Date('2026-06-07T00:00:00.000Z'),
      completedAt: null,
      pickStartedAt: new Date('2026-06-07T00:00:00.000Z'),
      pickDeadlineAt: new Date('2026-06-07T00:02:00.000Z'),
      pausedRemainingSeconds: null,
      schedulingVersion: 3,
      settings: {
        rosterSize: 1,
        benchSize: 0,
        pickSeconds: 120,
        allowAutoPick: true,
        positionLimits: {},
        autoPickRules: {},
        draftType: 'SNAKE',
      },
      participants: [
        {
          memberId: 'member-1',
          userId: 'statly-dev-tester',
          slot: 1,
          displayName: 'Statly Dev Tester',
          role: 'OWNER',
        },
        {
          memberId: 'member-2',
          userId: 'bot-user-1',
          slot: 2,
          displayName: 'CPU Team 1',
          role: 'MANAGER',
        },
      ],
      picks: [
        {
          id: 'pick-1',
          overall: 1,
          round: 1,
          slot: 1,
          memberId: 'member-1',
          playerId: 'player-1',
          auto: false,
        },
      ],
    });
    const rosterProjectionService = {
      projectDraft: vi.fn().mockResolvedValue({ projected: 2 }),
    };
    const service = new DraftApplicationService(rosterProjectionService as never);

    const result = await service.autoPick({
      draftId: 'draft-1',
      actorUserId: 'statly-dev-tester',
    });

    expect(result.isComplete).toBe(true);
    expect(result.events).toEqual(['draft:auto-pick', 'draft:completed']);
    expect(draftRepository.advanceDraft).toHaveBeenCalledWith({}, 'draft-1', 2, {
      nextPick: 3,
      nextRound: 1,
      nextDirection: DraftDirection.FORWARD,
      isComplete: true,
    });
    expect(rosterProjectionService.projectDraft).toHaveBeenCalledWith({
      leagueId: 'league-1',
      draftId: 'draft-1',
    });
    expect(draftScheduler.cancelPickExpiry).toHaveBeenCalledWith('draft-1');
    expect(draftScheduler.schedulePickExpiry).not.toHaveBeenCalled();
  });
});
