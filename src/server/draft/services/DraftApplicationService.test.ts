import { DraftStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const draftRepositoryMock = {
  transaction: vi.fn(),
  getDraftAggregate: vi.fn(),
  findPlayer: vi.fn(),
  createPick: vi.fn(),
  removeQueuedPlayer: vi.fn(),
  removeQueuedPlayerById: vi.fn(),
  advanceDraft: vi.fn(),
  updateDraftTiming: vi.fn(),
  createDraftEvents: vi.fn(),
  toEventPick: vi.fn(),
  findPickByOverall: vi.fn(),
  findQueuedPlayer: vi.fn(),
  findBestAvailablePlayer: vi.fn(),
};

const draftSchedulerMock = {
  cancelPickExpiry: vi.fn(),
  schedulePickExpiry: vi.fn(),
};

const leagueRepositoryMock = {
  updateMemberRoster: vi.fn(),
};

const inngestSendMock = vi.fn();

vi.mock('../repository/DraftRepository', () => ({
  draftRepository: draftRepositoryMock,
}));

vi.mock('./DraftScheduler', () => ({
  draftScheduler: draftSchedulerMock,
}));

vi.mock('@/server/league/repository/LeagueRepository', () => ({
  leagueRepository: leagueRepositoryMock,
}));

vi.mock('@/lib/inngest/client', () => ({
  inngest: {
    send: inngestSendMock,
  },
}));

function buildLiveDraftAggregate(
  overrides?: Partial<{
    currentPick: number;
    totalPicks: number;
    picks: Array<{
      id: string;
      overall: number;
      round: number;
      slot: number;
      memberId: string;
      playerId: string;
      auto: boolean;
    }>;
    participants: Array<{
      memberId: string;
      userId: string;
      slot: number;
      displayName: string;
      role: string;
    }>;
  }>
): {
  id: string;
  leagueId: string;
  status: DraftStatus;
  currentPick: number;
  totalPicks: number;
  round: number;
  direction: 'FORWARD' | 'REVERSE';
  startedAt: Date;
  completedAt: null;
  pickStartedAt: Date;
  pickDeadlineAt: Date;
  pausedRemainingSeconds: null;
  schedulingVersion: number;
  settings: {
    rosterSize: number;
    benchSize: number;
    pickSeconds: number;
    allowAutoPick: boolean;
    draftType: 'SNAKE';
  };
  participants: Array<{
    memberId: string;
    userId: string;
    slot: number;
    displayName: string;
    role: string;
  }>;
  picks: Array<{
    id: string;
    overall: number;
    round: number;
    slot: number;
    memberId: string;
    playerId: string;
    auto: boolean;
  }>;
} {
  return {
    id: 'draft-1',
    leagueId: 'league-1',
    status: DraftStatus.LIVE,
    currentPick: overrides?.currentPick ?? 1,
    totalPicks: overrides?.totalPicks ?? 2,
    round: 1,
    direction: 'FORWARD',
    startedAt: new Date('2026-04-02T08:00:00.000Z'),
    completedAt: null,
    pickStartedAt: new Date('2026-04-02T08:00:00.000Z'),
    pickDeadlineAt: new Date('2026-04-02T08:02:00.000Z'),
    pausedRemainingSeconds: null,
    schedulingVersion: 3,
    settings: {
      rosterSize: 1,
      benchSize: 0,
      pickSeconds: 120,
      allowAutoPick: true,
      draftType: 'SNAKE',
    },
    participants: overrides?.participants ?? [
      {
        memberId: 'member-1',
        userId: 'user-1',
        slot: 1,
        displayName: 'User 1',
        role: 'OWNER',
      },
      {
        memberId: 'member-2',
        userId: 'user-2',
        slot: 2,
        displayName: 'User 2',
        role: 'MEMBER',
      },
    ],
    picks: overrides?.picks ?? [],
  };
}

describe('DraftApplicationService roster sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    draftRepositoryMock.transaction.mockImplementation(
      async (work: (tx: object) => Promise<unknown>) => work({} as object)
    );
    draftRepositoryMock.findPlayer.mockResolvedValue({
      id: 'player-2',
      name: 'Player 2',
      position: 'MID',
      club: 'Club',
      active: true,
    });
    draftRepositoryMock.createPick.mockResolvedValue({
      id: 'pick-2',
      overall: 2,
      round: 1,
      slot: 2,
      memberId: 'member-2',
      playerId: 'player-2',
      auto: false,
      player: { id: 'player-2', name: 'Player 2', position: 'MID', club: 'Club' },
    });
    draftRepositoryMock.removeQueuedPlayer.mockResolvedValue(undefined);
    draftRepositoryMock.removeQueuedPlayerById.mockResolvedValue(undefined);
    draftRepositoryMock.advanceDraft.mockResolvedValue({ count: 1 });
    draftRepositoryMock.updateDraftTiming.mockResolvedValue({ count: 1 });
    draftRepositoryMock.createDraftEvents.mockResolvedValue([{ id: 'event-1' }]);
    draftRepositoryMock.toEventPick.mockReturnValue({
      draftId: 'draft-1',
      playerId: 'player-2',
      memberId: 'member-2',
      overall: 2,
      round: 1,
      slot: 2,
      auto: false,
    });
    draftRepositoryMock.findQueuedPlayer.mockResolvedValue(null);
    draftRepositoryMock.findBestAvailablePlayer.mockResolvedValue({
      id: 'player-2',
      name: 'Player 2',
      position: 'MID',
      club: 'Club',
      active: true,
    });
    draftSchedulerMock.cancelPickExpiry.mockResolvedValue(undefined);
    draftSchedulerMock.schedulePickExpiry.mockResolvedValue(undefined);
    leagueRepositoryMock.updateMemberRoster.mockResolvedValue(undefined);
    inngestSendMock.mockResolvedValue({ ids: ['event-1'] });
  });

  it('syncs member rosters when a manual pick completes the draft', async () => {
    const { draftApplicationService } = await import('./DraftApplicationService');

    draftRepositoryMock.getDraftAggregate.mockResolvedValue(
      buildLiveDraftAggregate({
        currentPick: 2,
        totalPicks: 2,
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
      })
    );

    await draftApplicationService.makePick({
      draftId: 'draft-1',
      actorUserId: 'user-2',
      playerId: 'player-2',
    });

    expect(leagueRepositoryMock.updateMemberRoster).toHaveBeenCalledTimes(2);
    expect(leagueRepositoryMock.updateMemberRoster).toHaveBeenNthCalledWith(
      1,
      {},
      {
        leagueId: 'league-1',
        memberId: 'member-1',
        playerIds: ['player-1'],
      }
    );
    expect(leagueRepositoryMock.updateMemberRoster).toHaveBeenNthCalledWith(
      2,
      {},
      {
        leagueId: 'league-1',
        memberId: 'member-2',
        playerIds: ['player-2'],
      }
    );
    expect(inngestSendMock).toHaveBeenCalledTimes(1);
    expect(inngestSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'statly/draft.completed',
        data: expect.objectContaining({
          draftId: 'draft-1',
          leagueId: 'league-1',
          season: expect.any(Number),
        }),
      })
    );
  });

  it('does not sync member rosters before the draft completes', async () => {
    const { draftApplicationService } = await import('./DraftApplicationService');

    draftRepositoryMock.getDraftAggregate.mockResolvedValue(
      buildLiveDraftAggregate({
        currentPick: 1,
        totalPicks: 3,
      })
    );

    await draftApplicationService.makePick({
      draftId: 'draft-1',
      actorUserId: 'user-1',
      playerId: 'player-2',
    });

    expect(leagueRepositoryMock.updateMemberRoster).not.toHaveBeenCalled();
    expect(inngestSendMock).not.toHaveBeenCalled();
  });

  it('syncs member rosters when an auto-pick completes the draft', async () => {
    const { draftApplicationService } = await import('./DraftApplicationService');

    draftRepositoryMock.getDraftAggregate.mockResolvedValue(
      buildLiveDraftAggregate({
        currentPick: 2,
        totalPicks: 2,
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
      })
    );
    draftRepositoryMock.createPick.mockResolvedValue({
      id: 'pick-2',
      overall: 2,
      round: 1,
      slot: 2,
      memberId: 'member-2',
      playerId: 'player-2',
      auto: true,
      player: { id: 'player-2', name: 'Player 2', position: 'MID', club: 'Club' },
    });
    draftRepositoryMock.toEventPick.mockReturnValue({
      draftId: 'draft-1',
      playerId: 'player-2',
      memberId: 'member-2',
      overall: 2,
      round: 1,
      slot: 2,
      auto: true,
    });

    await draftApplicationService.autoPick({ draftId: 'draft-1' });

    expect(leagueRepositoryMock.updateMemberRoster).toHaveBeenCalledTimes(2);
    expect(leagueRepositoryMock.updateMemberRoster).toHaveBeenNthCalledWith(
      1,
      {},
      {
        leagueId: 'league-1',
        memberId: 'member-1',
        playerIds: ['player-1'],
      }
    );
    expect(leagueRepositoryMock.updateMemberRoster).toHaveBeenNthCalledWith(
      2,
      {},
      {
        leagueId: 'league-1',
        memberId: 'member-2',
        playerIds: ['player-2'],
      }
    );
    expect(inngestSendMock).toHaveBeenCalledTimes(1);
    expect(inngestSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'statly/draft.completed',
        data: expect.objectContaining({
          draftId: 'draft-1',
          leagueId: 'league-1',
          season: expect.any(Number),
        }),
      })
    );
  });
});
