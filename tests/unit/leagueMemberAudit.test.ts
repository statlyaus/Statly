import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/server/draft/draftOrderWriter', () => ({ writeDraftOrder: vi.fn() }));
vi.mock('@/server/leagues/leagueFormat', () => ({ clearBloodsuckerOnDeparture: vi.fn() }));

import { removeLeagueMember, transferLeagueOwnership } from '@/server/leagues/memberCommands';

const member = (id: string, userId: string) => ({
  id,
  userId,
  isActive: true,
  status: 'ACTIVE',
  draftSlot: null,
});

const tx = {
  $executeRaw: vi.fn().mockResolvedValue(1),
  league: { findUnique: vi.fn(), update: vi.fn() },
  leagueMember: { update: vi.fn(), updateMany: vi.fn() },
  leagueCompetitionAudit: { create: vi.fn() },
};
const client = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } as never;

describe('membership changes are audited (league-21)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.league.findUnique.mockResolvedValue({
      id: 'league-1',
      ownerId: 'owner',
      settings: {
        competitionPublishedAt: null,
        leagueFormat: 'STANDARD',
        bloodsuckerMemberId: null,
      },
      members: [member('m-owner', 'owner'), member('m-2', 'user-2')],
      drafts: [],
    });
  });

  it('records a member removal with who removed whom', async () => {
    await removeLeagueMember(
      { leagueId: 'league-1', actorUserId: 'owner', targetUserId: 'user-2' },
      client
    );

    expect(tx.leagueCompetitionAudit.create).toHaveBeenCalledWith({
      data: {
        leagueId: 'league-1',
        actorMemberId: 'm-owner',
        eventType: 'MEMBER_REMOVED',
        payloadJson: { memberId: 'm-2', userId: 'user-2', left: false },
      },
    });
  });

  it('records an ownership transfer with the old and new owner', async () => {
    await transferLeagueOwnership(
      { leagueId: 'league-1', actorUserId: 'owner', targetUserId: 'user-2' },
      client
    );

    expect(tx.leagueCompetitionAudit.create).toHaveBeenCalledWith({
      data: {
        leagueId: 'league-1',
        actorMemberId: 'm-owner',
        eventType: 'OWNERSHIP_TRANSFERRED',
        payloadJson: { fromUserId: 'owner', toUserId: 'user-2', toMemberId: 'm-2' },
      },
    });
  });
});
