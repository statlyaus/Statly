import { beforeEach, describe, expect, it, vi } from 'vitest';

const etlMocks = vi.hoisted(() => ({
  getRoundPlayerStatsResult: vi.fn().mockResolvedValue({ ok: true, stats: [] }),
  getRoundMatchesResult: vi.fn().mockResolvedValue({ ok: true, matches: [] }),
}));

const prismaMocks = vi.hoisted(() => ({
  $transaction: vi.fn(),
  league: { findUnique: vi.fn() },
  leagueCompetitionRound: { findUnique: vi.fn() },
  leagueMatchup: { findMany: vi.fn() },
  leagueLineup: { findMany: vi.fn() },
  leagueMember: { findMany: vi.fn() },
}));

vi.mock('@/lib/etlIntegration', () => etlMocks);
vi.mock('@/lib/prisma', () => ({ prisma: prismaMocks }));

import { recalculateLeagueRoundMatchups } from '@/server/leagues/matchupReadModel';

function leagueWithFixtureVersion(competitionRulesVersion: number) {
  return {
    id: 'league-1',
    categoriesJson: JSON.stringify(['goals']),
    settings: {
      scoringMode: 'H2H_EACH_CATEGORY',
      fixtureGenerationMode: 'AUTOMATIC',
      lineupSlotsJson: null,
      categoryDirectionsJson: null,
      competitionStatus: competitionRulesVersion === 0 ? 'SETUP' : 'PENDING',
      competitionRulesJson: null,
      competitionRulesVersion,
    },
  };
}

describe('recalculateLeagueRoundMatchups AFL round mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.leagueMatchup.findMany.mockResolvedValue([]);
    prismaMocks.leagueLineup.findMany.mockResolvedValue([]);
    prismaMocks.leagueMember.findMany.mockResolvedValue([]);
    etlMocks.getRoundPlayerStatsResult.mockResolvedValue({ ok: true, stats: [] });
    etlMocks.getRoundMatchesResult.mockResolvedValue({ ok: true, matches: [] });
  });

  it('loads provider data using the mapped AFL round for a versioned fixture', async () => {
    prismaMocks.league.findUnique.mockResolvedValue(leagueWithFixtureVersion(7));
    prismaMocks.leagueCompetitionRound.findUnique.mockResolvedValue({ aflRound: 12 });

    await recalculateLeagueRoundMatchups({ leagueId: 'league-1', round: 4 });

    expect(prismaMocks.leagueCompetitionRound.findUnique).toHaveBeenCalledWith({
      where: {
        leagueId_fixtureVersion_round: { leagueId: 'league-1', fixtureVersion: 7, round: 4 },
      },
      select: { aflRound: true },
    });
    expect(prismaMocks.leagueMatchup.findMany).toHaveBeenCalledWith({
      where: { leagueId: 'league-1', round: 4, fixtureVersion: 7 },
    });
    expect(etlMocks.getRoundMatchesResult).toHaveBeenCalledWith(new Date().getFullYear(), 12);
    expect(etlMocks.getRoundPlayerStatsResult).toHaveBeenCalledWith(new Date().getFullYear(), 12);
  });

  it('falls back to the fantasy round only for legacy unversioned fixtures', async () => {
    prismaMocks.league.findUnique.mockResolvedValue(leagueWithFixtureVersion(0));

    await recalculateLeagueRoundMatchups({ leagueId: 'league-1', round: 4 });

    expect(prismaMocks.leagueCompetitionRound.findUnique).not.toHaveBeenCalled();
    expect(etlMocks.getRoundMatchesResult).toHaveBeenCalledWith(new Date().getFullYear(), 4);
  });

  it('does not fetch or score a versioned round whose AFL mapping is unavailable', async () => {
    prismaMocks.league.findUnique.mockResolvedValue(leagueWithFixtureVersion(7));
    prismaMocks.leagueCompetitionRound.findUnique.mockResolvedValue({ aflRound: null });

    const result = await recalculateLeagueRoundMatchups({ leagueId: 'league-1', round: 4 });

    expect(etlMocks.getRoundPlayerStatsResult).not.toHaveBeenCalled();
    expect(etlMocks.getRoundMatchesResult).not.toHaveBeenCalled();
    expect(result).toMatchObject({ round: 4, status: 'SCHEDULED', recalculated: 0, scores: [] });
  });

  it('does not calculate scores when the round-scoped stats provider fails', async () => {
    prismaMocks.league.findUnique.mockResolvedValue(leagueWithFixtureVersion(7));
    prismaMocks.leagueCompetitionRound.findUnique.mockResolvedValue({ aflRound: 12 });
    etlMocks.getRoundPlayerStatsResult.mockResolvedValue({
      ok: false,
      error: new Error('provider unavailable'),
    });

    const result = await recalculateLeagueRoundMatchups({
      leagueId: 'league-1',
      round: 4,
      finalize: true,
    });

    expect(result).toMatchObject({
      round: 4,
      status: 'SCHEDULED',
      recalculated: 0,
      scores: [],
      roundStatus: { hasUnavailableStatus: true },
    });
  });

  it('does not score or finalize when provider stats omit a lineup player', async () => {
    prismaMocks.league.findUnique.mockResolvedValue(leagueWithFixtureVersion(7));
    prismaMocks.leagueCompetitionRound.findUnique.mockResolvedValue({ aflRound: 12 });
    prismaMocks.leagueMatchup.findMany.mockResolvedValue([
      {
        id: 'matchup-1',
        homeMemberId: 'member-1',
        awayMemberId: 'member-2',
      },
    ]);
    prismaMocks.leagueLineup.findMany.mockResolvedValue([
      { memberId: 'member-1', players: [{ playerId: 'player-1', slot: 'MID' }] },
      { memberId: 'member-2', players: [{ playerId: 'player-2', slot: 'MID' }] },
    ]);
    etlMocks.getRoundPlayerStatsResult.mockResolvedValue({
      ok: true,
      stats: [
        {
          player_uid: 'player-1',
          round_number: 12,
          status: 'final',
          stats: { goals: 1 },
        },
      ],
    });
    etlMocks.getRoundMatchesResult.mockResolvedValue({
      ok: true,
      matches: [{ match_uid: 'afl-match-1', status: 'final' }],
    });

    const result = await recalculateLeagueRoundMatchups({
      leagueId: 'league-1',
      round: 4,
      finalize: true,
    });

    expect(result).toMatchObject({
      round: 4,
      status: 'SCHEDULED',
      recalculated: 0,
      scores: [],
      roundStatus: { hasUnavailableStatus: true },
    });
    expect(prismaMocks.$transaction).not.toHaveBeenCalled();
  });
});
