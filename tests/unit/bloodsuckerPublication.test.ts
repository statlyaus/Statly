import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_COMPETITION_RULES } from '@/server/leagues/competitionRules';

const prismaMocks = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('@/server/etl/etlRoundData', () => ({ getRoundMatches: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMocks }));

import { publishCompetition } from '@/server/leagues/competitionService';

const rules = { ...DEFAULT_COMPETITION_RULES, regularSeasonRounds: 1, finalsTeams: 0 as const };
const members = Array.from({ length: 8 }, (_, index) => ({ id: `member-${index + 1}` }));

function leagueWith(settings: { leagueFormat: string; bloodsuckerMemberId: string | null }) {
  return {
    id: 'league-1',
    settingsId: 'settings-1',
    activeSeasonId: 'season-1',
    categoriesJson: ['goals'],
    settings: {
      competitionStatus: 'SETUP',
      competitionRulesVersion: 0,
      competitionRulesJson: null,
      lineupSlotsJson: null,
      rosterSize: 30,
      ...settings,
    },
    members,
  };
}

describe('publishing a Bloodsucker league (BR-08)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['no Bloodsucker', null],
    ['a Bloodsucker who has left', 'member-left'],
  ])('refuses publication with %s and writes nothing', async (_label, bloodsuckerMemberId) => {
    prismaMocks.league.findUnique.mockResolvedValue(
      leagueWith({ leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId })
    );

    const result = await publishCompetition({
      leagueId: 'league-1',
      actorMemberId: 'member-1',
      rules,
    });

    expect(result).toEqual({
      ok: false,
      code: 'BLOODSUCKER_MISSING',
      errors: ['Choose a Bloodsucker before publishing the competition.'],
    });
    expect(prismaMocks.$transaction).not.toHaveBeenCalled();
  });

  it('lets a Bloodsucker league with its Bloodsucker set reach the publish transaction', async () => {
    prismaMocks.league.findUnique.mockResolvedValue(
      leagueWith({ leagueFormat: 'BLOODSUCKER', bloodsuckerMemberId: 'member-3' })
    );
    prismaMocks.$transaction.mockRejectedValue(new Error('reached the transaction'));

    await expect(
      publishCompetition({ leagueId: 'league-1', actorMemberId: 'member-1', rules })
    ).rejects.toThrow('reached the transaction');
  });
});
