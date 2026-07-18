import { beforeEach, describe, expect, it, vi } from 'vitest';

const activityMocks = vi.hoisted(() => ({
  logLeagueActivity: vi.fn().mockResolvedValue(undefined),
}));

const txMocks = vi.hoisted(() => ({
  leagueMatchup: { updateMany: vi.fn() },
  leagueCompetitionAudit: { create: vi.fn() },
}));

const prismaMocks = vi.hoisted(() => ({
  leagueMatchup: { findMany: vi.fn() },
  $transaction: vi.fn((work: (tx: typeof txMocks) => Promise<unknown>) => work(txMocks)),
}));

vi.mock('@/lib/activity', () => activityMocks);
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMocks }));

import { synchronizeFinalsFixtures } from '@/server/leagues/finalsService';

describe('synchronizeFinalsFixtures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.$transaction.mockImplementation((work) => work(txMocks));
    txMocks.leagueMatchup.updateMany.mockResolvedValue({ count: 1 });
    txMocks.leagueCompetitionAudit.create.mockResolvedValue({});
  });

  it('seeds empty opening finals fixtures from regular-season order', async () => {
    prismaMocks.leagueMatchup.findMany.mockResolvedValue([
      {
        id: 'semi-1',
        bracketKey: 'SF_1_V_4',
        status: 'SCHEDULED',
        homeMemberId: null,
        awayMemberId: null,
        homeCategoryWins: 0,
        awayCategoryWins: 0,
      },
      {
        id: 'semi-2',
        bracketKey: 'SF_2_V_3',
        status: 'SCHEDULED',
        homeMemberId: null,
        awayMemberId: null,
        homeCategoryWins: 0,
        awayCategoryWins: 0,
      },
      {
        id: 'grand-final',
        bracketKey: 'GF',
        status: 'SCHEDULED',
        homeMemberId: null,
        awayMemberId: null,
        homeCategoryWins: 0,
        awayCategoryWins: 0,
      },
    ]);

    await expect(
      synchronizeFinalsFixtures({
        leagueId: 'league-1',
        fixtureVersion: 2,
        finalsTeams: 4,
        orderedRegularSeasonMemberIds: ['team-1', 'team-2', 'team-3', 'team-4'],
      })
    ).resolves.toEqual({ updated: 2 });
    expect(txMocks.leagueMatchup.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'semi-1',
        status: 'SCHEDULED',
        homeMemberId: null,
        awayMemberId: null,
      },
      data: { homeMemberId: 'team-1', awayMemberId: 'team-4' },
    });
    expect(txMocks.leagueMatchup.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'semi-2',
        status: 'SCHEDULED',
        homeMemberId: null,
        awayMemberId: null,
      },
      data: { homeMemberId: 'team-2', awayMemberId: 'team-3' },
    });
    expect(txMocks.leagueCompetitionAudit.create).toHaveBeenCalledOnce();
  });

  it('does not overwrite an assigned or finalized fixture', async () => {
    prismaMocks.leagueMatchup.findMany.mockResolvedValue([
      {
        id: 'semi-1',
        bracketKey: 'SF_1_V_4',
        status: 'FINAL',
        homeMemberId: 'team-1',
        awayMemberId: 'team-4',
        homeCategoryWins: 5,
        awayCategoryWins: 4,
      },
      {
        id: 'semi-2',
        bracketKey: 'SF_2_V_3',
        status: 'SCHEDULED',
        homeMemberId: 'team-2',
        awayMemberId: 'team-3',
        homeCategoryWins: 0,
        awayCategoryWins: 0,
      },
      {
        id: 'grand-final',
        bracketKey: 'GF',
        status: 'SCHEDULED',
        homeMemberId: null,
        awayMemberId: null,
        homeCategoryWins: 0,
        awayCategoryWins: 0,
      },
    ]);

    const result = await synchronizeFinalsFixtures({
      leagueId: 'league-1',
      fixtureVersion: 2,
      finalsTeams: 4,
      orderedRegularSeasonMemberIds: ['team-1', 'team-2', 'team-3', 'team-4'],
    });

    expect(result).toEqual({ updated: 0 });
    expect(txMocks.leagueMatchup.updateMany).not.toHaveBeenCalled();
    expect(txMocks.leagueCompetitionAudit.create).not.toHaveBeenCalled();
  });
});
