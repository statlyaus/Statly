import {
  DraftDirection,
  DraftStatus,
  DraftType,
  LeagueRole,
  PickOrder,
  WaiverRule,
} from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DraftProjectionService } from '@/server/draft/services/DraftProjectionService';

const prismaMock = vi.hoisted(() => ({
  draft: {
    findUnique: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('DraftProjectionService', () => {
  it('preserves draft identity metadata in legacy socket updates', async () => {
    prismaMock.draft.findUnique.mockResolvedValue({
      id: 'draft-1',
      leagueId: 'league-1',
      status: DraftStatus.LIVE,
      currentPick: 1,
      totalPicks: 264,
      round: 1,
      direction: DraftDirection.FORWARD,
      completedAt: null,
      lobbyStatus: null,
      league: {
        name: 'Test AFL Champions League',
        settings: {
          rosterSize: 18,
          benchSize: 4,
          maxTeams: 12,
          pickSeconds: 60,
          allowAutoPick: true,
          draftType: DraftType.SNAKE,
          pickOrder: PickOrder.RANDOM,
          waiverRule: WaiverRule.WEEKLY,
        },
      },
      orders: [
        {
          slot: 1,
          memberId: 'member-1',
          member: {
            userId: 'user-1',
            role: LeagueRole.MANAGER,
            user: {
              id: 'user-1',
              displayName: 'Robbo Rockers',
              email: 'robbo@example.com',
            },
          },
        },
      ],
      picks: [],
    });

    const update = await new DraftProjectionService().buildLegacyDraftUpdate('draft-1');

    expect(update).toMatchObject({
      draftId: 'draft-1',
      leagueId: 'league-1',
      name: 'Test AFL Champions League - LIVE',
    });
  });
});
