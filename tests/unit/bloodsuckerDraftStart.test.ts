import { DraftStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// BR-02, BR-06: every start path (room button and scheduled worker) goes through startDraft, which
// refuses a Bloodsucker draft with no Bloodsucker or fewer than 8 teams. The format locks once the
// draft starts, so starting without them would leave the league unfixable.

const { draftRepository } = vi.hoisted(() => ({
  draftRepository: {
    transaction: vi.fn(),
    getDraftAggregate: vi.fn(),
    updateDraftLobbyState: vi.fn(),
  },
}));

vi.mock('@/server/draft/repository/DraftRepository', () => ({ draftRepository }));
vi.mock('@/server/rosters/RosterProjectionService', () => ({
  RosterProjectionService: class {},
}));

import { DraftApplicationService } from '@/server/draft/services/DraftApplicationService';

const activeIds = Array.from({ length: 8 }, (_, index) => `member-${index + 1}`);

function txFor(settings: { leagueFormat: string; bloodsuckerMemberId: string | null }) {
  return {
    league: {
      findUnique: vi.fn().mockResolvedValue({
        settings,
        members: activeIds.map((id) => ({ id, isActive: true, status: 'ACTIVE' })),
      }),
    },
  };
}

describe('starting a Bloodsucker draft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    draftRepository.getDraftAggregate.mockResolvedValue({
      id: 'draft-1',
      leagueId: 'league-1',
      status: DraftStatus.SCHEDULED,
      participants: [{ userId: 'owner-user', canManageDraft: true }],
      settings: { pickSeconds: 60 },
      schedulingVersion: 0,
    });
    // Stop at the first write so the test only covers the guard.
    draftRepository.updateDraftLobbyState.mockRejectedValue(new Error('passed the guard'));
  });

  it('refuses to start with no Bloodsucker', async () => {
    const tx = txFor({ leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: null });
    draftRepository.transaction.mockImplementation((work) => work(tx));

    await expect(new DraftApplicationService().startDraft({ draftId: 'draft-1' })).rejects.toThrow(
      'bad_request:Choose a Bloodsucker.'
    );
    expect(draftRepository.updateDraftLobbyState).not.toHaveBeenCalled();
    expect(tx.league.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'league-1' } })
    );
  });

  it.each([
    ['a Bloodsucker league with its Bloodsucker', 'BLOODSUCKER', 'member-3'],
    ['a standard league', 'STANDARD', null],
  ])('lets %s start', async (_label, leagueFormat, bloodsuckerMemberId) => {
    draftRepository.transaction.mockImplementation((work) =>
      work(txFor({ leagueFormat, bloodsuckerMemberId }))
    );

    await expect(new DraftApplicationService().startDraft({ draftId: 'draft-1' })).rejects.toThrow(
      'passed the guard'
    );
  });
});
