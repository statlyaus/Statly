import { DraftDirection, DraftStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { draftRepository, draftScheduler, statlyZStatsLookup } = vi.hoisted(() => ({
  draftRepository: {
    transaction: vi.fn(),
    getDraftAggregate: vi.fn(),
    findQueuedPlayer: vi.fn(),
    findPlayer: vi.fn(),
    listAvailableAutoPickCandidates: vi.fn(),
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
  statlyZStatsLookup: {
    byId: new Map([
      [
        'statly-low',
        {
          avgPoints: 0,
          averagePoints: 0,
          fantasyPoints: 0,
          gamesPlayed: 1,
          stats: { goals: 1, tackles: 1 },
          statsTotal: { goals: 1, tackles: 1 },
        },
      ],
      [
        'statly-high',
        {
          avgPoints: 0,
          averagePoints: 0,
          fantasyPoints: 0,
          gamesPlayed: 1,
          stats: { goals: 8, tackles: 10 },
          statsTotal: { goals: 8, tackles: 10 },
        },
      ],
    ]),
    byNameAndTeam: new Map(),
    byName: new Map(),
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

vi.mock('@/server/draft/readModels/draftPlayerReadModel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/draft/readModels/draftPlayerReadModel')>();

  return {
    ...actual,
    loadDraftPlayerStatsLookup: vi.fn().mockResolvedValue(statlyZStatsLookup),
  };
});

import { DraftApplicationService } from '@/server/draft/services/DraftApplicationService';

describe('DraftApplicationService completion projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    draftRepository.transaction.mockImplementation((work) => work({}));
    draftRepository.findQueuedPlayer.mockResolvedValue(null);
    draftRepository.listAvailableAutoPickCandidates.mockResolvedValue([
      {
        id: 'player-2',
        name: 'Second Player',
        position: 'MID',
        club: 'Sydney',
        active: true,
      },
    ]);
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
        selectedCategories: ['goals', 'tackles'],
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

  it('auto-picks the highest Statly Z player when the current team has no valid queued player', async () => {
    draftRepository.getDraftAggregate.mockResolvedValue({
      id: 'draft-1',
      leagueId: 'league-1',
      status: DraftStatus.LIVE,
      currentPick: 1,
      totalPicks: 3,
      round: 1,
      direction: DraftDirection.FORWARD,
      startedAt: new Date('2026-06-07T00:00:00.000Z'),
      completedAt: null,
      pickStartedAt: new Date('2026-06-07T00:00:00.000Z'),
      pickDeadlineAt: new Date('2026-06-07T00:02:00.000Z'),
      pausedRemainingSeconds: null,
      schedulingVersion: 3,
      settings: {
        rosterSize: 3,
        benchSize: 0,
        pickSeconds: 120,
        allowAutoPick: true,
        selectedCategories: ['goals', 'tackles'],
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
      picks: [],
    });
    draftRepository.listAvailableAutoPickCandidates.mockResolvedValue([
      {
        id: 'statly-low',
        name: 'Lower Statly Z',
        position: 'MID',
        club: 'Sydney',
        active: true,
      },
      {
        id: 'statly-high',
        name: 'Higher Statly Z',
        position: 'MID',
        club: 'Collingwood',
        active: true,
      },
    ]);
    draftRepository.createPick.mockResolvedValue({
      id: 'pick-1',
      draftId: 'draft-1',
      overall: 1,
      round: 1,
      slot: 1,
      memberId: 'member-1',
      playerId: 'statly-high',
      auto: true,
      player: {
        id: 'statly-high',
        name: 'Higher Statly Z',
        position: 'MID',
        club: 'Collingwood',
      },
      member: {
        user: {
          id: 'statly-dev-tester',
          displayName: 'Statly Dev Tester',
          email: 'statly-dev-tester@statly.local',
        },
      },
    });

    const service = new DraftApplicationService({ projectDraft: vi.fn() } as never);

    await service.autoPick({
      draftId: 'draft-1',
      actorUserId: 'statly-dev-tester',
    });

    expect(draftRepository.findQueuedPlayer).toHaveBeenCalledWith({}, 'draft-1', 'member-1', []);
    expect(draftRepository.listAvailableAutoPickCandidates).toHaveBeenCalledWith({}, []);
    expect(draftRepository.createPick).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        memberId: 'member-1',
        playerId: 'statly-high',
        auto: true,
      })
    );
  });

  it('uses the current team queue before falling back to Statly Z', async () => {
    draftRepository.getDraftAggregate.mockResolvedValue({
      id: 'draft-1',
      leagueId: 'league-1',
      status: DraftStatus.LIVE,
      currentPick: 1,
      totalPicks: 3,
      round: 1,
      direction: DraftDirection.FORWARD,
      startedAt: new Date('2026-06-07T00:00:00.000Z'),
      completedAt: null,
      pickStartedAt: new Date('2026-06-07T00:00:00.000Z'),
      pickDeadlineAt: new Date('2026-06-07T00:02:00.000Z'),
      pausedRemainingSeconds: null,
      schedulingVersion: 3,
      settings: {
        rosterSize: 3,
        benchSize: 0,
        pickSeconds: 120,
        allowAutoPick: true,
        selectedCategories: ['goals', 'tackles'],
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
      ],
      picks: [],
    });
    draftRepository.findQueuedPlayer.mockResolvedValue({ id: 'queue-1', playerId: 'queued-player' });
    draftRepository.findPlayer.mockResolvedValue({
      id: 'queued-player',
      name: 'Queued Player',
      position: 'FWD',
      club: 'Carlton',
      active: true,
    });
    draftRepository.createPick.mockResolvedValue({
      id: 'pick-1',
      draftId: 'draft-1',
      overall: 1,
      round: 1,
      slot: 1,
      memberId: 'member-1',
      playerId: 'queued-player',
      auto: true,
      player: {
        id: 'queued-player',
        name: 'Queued Player',
        position: 'FWD',
        club: 'Carlton',
      },
      member: {
        user: {
          id: 'statly-dev-tester',
          displayName: 'Statly Dev Tester',
          email: 'statly-dev-tester@statly.local',
        },
      },
    });

    const service = new DraftApplicationService({ projectDraft: vi.fn() } as never);

    const result = await service.autoPick({
      draftId: 'draft-1',
      actorUserId: 'statly-dev-tester',
    });

    expect(draftRepository.listAvailableAutoPickCandidates).not.toHaveBeenCalled();
    expect(draftRepository.createPick).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ playerId: 'queued-player', auto: true })
    );
    expect(draftRepository.removeQueuedPlayerById).toHaveBeenCalledWith({}, 'queue-1');
    expect(result.data.wasQueued).toBe(true);
  });
});
