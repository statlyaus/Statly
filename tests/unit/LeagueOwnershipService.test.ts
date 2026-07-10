import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import {
  LeagueOwnershipService,
  OwnershipMutationError,
} from '@/server/rosters/LeagueOwnershipService';

describe('LeagueOwnershipService', () => {
  it('does not create free-agent ownership while an active waiver hold exists', async () => {
    const tx = {
      leagueMember: { findUnique: vi.fn().mockResolvedValue({ leagueId: 'league-1' }) },
      player: { findUnique: vi.fn().mockResolvedValue({ id: 'player-1' }) },
      leagueRosterPlayer: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      leagueWaiverHold: {
        findUnique: vi.fn().mockResolvedValue({ availableAt: new Date(Date.now() + 60_000) }),
      },
    };
    const service = new LeagueOwnershipService({
      $transaction: vi.fn((work) => work(tx)),
    } as never);

    await expect(
      service.addFreeAgent({ leagueId: 'league-1', memberId: 'member-1', playerId: 'player-1' })
    ).rejects.toMatchObject<Partial<OwnershipMutationError>>({ code: 'PLAYER_ON_WAIVERS' });
    expect(tx.leagueRosterPlayer.create).not.toHaveBeenCalled();
  });
});
