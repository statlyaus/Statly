import { beforeEach, describe, expect, it, vi } from 'vitest';

// Owner decision 2026-11-09: a stat the provider did not report is unavailable, never a real 0.
// A lineup player missing a value for one of the league's categories holds the round unscored.

const etlMocks = vi.hoisted(() => ({
  getRoundPlayerStatsResult: vi.fn(),
  getRoundMatchesResult: vi.fn(),
}));

const prismaMocks = vi.hoisted(() => {
  const mocks = {
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    league: { findUnique: vi.fn() },
    leagueCompetitionRound: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
    leagueMatchup: { findMany: vi.fn(), update: vi.fn() },
    leagueMatchupScore: { upsert: vi.fn(), findMany: vi.fn() },
    leagueStanding: { upsert: vi.fn() },
    leagueLineup: { findMany: vi.fn() },
    leagueMember: { findMany: vi.fn() },
    // No reviewed Footywire identity links: stats rows keep their own player ids.
    playerExternalIdentity: { findMany: vi.fn() },
  };
  mocks.$transaction.mockImplementation((work: (tx: typeof mocks) => unknown) => work(mocks));
  return mocks;
});

vi.mock('@/server/etl/etlRoundData', () => etlMocks);
vi.mock('@/lib/prisma', () => ({ prisma: prismaMocks }));
vi.mock('@/server/leagues/defaultLineups', () => ({
  ensureDefaultLineups: vi.fn().mockResolvedValue(0),
}));

import { recalculateLeagueRoundMatchups } from '@/server/leagues/matchupReadModel';

function league(categoriesJson: string[]) {
  return {
    id: 'league-1',
    activeSeasonId: 'season-1',
    categoriesJson,
    settings: {
      scoringMode: 'H2H_EACH_CATEGORY',
      fixtureGenerationMode: 'AUTOMATIC',
      lineupSlotsJson: null,
      categoryDirectionsJson: null,
      competitionStatus: 'PENDING',
      competitionRulesJson: null,
      competitionRulesVersion: 7,
    },
  };
}

const lineup = (memberId: string, playerId: string) => ({
  id: `lineup-${memberId}`,
  memberId,
  players: [{ id: `a-${playerId}`, playerId, slot: 'MID', slotIndex: 0, player: { club: 'GWS' } }],
});

function givenRound(categories: string[], stats: Record<string, Record<string, unknown>>) {
  prismaMocks.league.findUnique.mockResolvedValue(league(categories));
  prismaMocks.leagueCompetitionRound.findUnique.mockResolvedValue({ aflRound: 12 });
  prismaMocks.leagueMatchup.findMany.mockResolvedValue([
    { id: 'matchup-1', homeMemberId: 'member-1', awayMemberId: 'member-2' },
  ]);
  prismaMocks.leagueLineup.findMany.mockResolvedValue([
    lineup('member-1', 'player-1'),
    lineup('member-2', 'player-2'),
  ]);
  etlMocks.getRoundPlayerStatsResult.mockResolvedValue({
    ok: true,
    stats: Object.entries(stats).map(([playerUid, playerStats]) => ({
      player_uid: playerUid,
      round_number: 12,
      stats: playerStats,
    })),
  });
  etlMocks.getRoundMatchesResult.mockResolvedValue({
    ok: true,
    matches: [
      { match_uid: 'afl-match-1', status: 'live', home_team: 'GWS Giants', away_team: 'Carlton' },
    ],
  });
}

describe('a missing stat is unavailable, not 0', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.leagueMatchupScore.findMany.mockResolvedValue([]);
    prismaMocks.leagueCompetitionRound.count.mockResolvedValue(1);
    prismaMocks.leagueMember.findMany.mockResolvedValue([]);
    prismaMocks.playerExternalIdentity.findMany.mockResolvedValue([]);
  });

  it('holds the round unscored and names the player whose row lacks a league category', async () => {
    givenRound(['goals', 'tackles'], {
      'player-1': { goals: 2, tackles: 5 },
      'player-2': { goals: 1, tackles: null },
    });

    const result = await recalculateLeagueRoundMatchups({ leagueId: 'league-1', round: 4 });

    expect(result).toMatchObject({
      status: 'SCHEDULED',
      recalculated: 0,
      scores: [],
      missingPlayerIds: ['player-2'],
      roundStatus: { hasUnavailableStatus: true },
    });
    expect(prismaMocks.$transaction).not.toHaveBeenCalled();
  });

  it('ignores a missing stat in a category the league does not score', async () => {
    givenRound(['goals'], {
      'player-1': { goals: 2 },
      'player-2': { goals: 0 },
    });

    const result = await recalculateLeagueRoundMatchups({ leagueId: 'league-1', round: 4 });

    expect(result).toMatchObject({ recalculated: 1 });
    expect(prismaMocks.$transaction).toHaveBeenCalledTimes(1);
  });

  it('scores a player with no disposals, whose disposal efficiency is empty, not missing', async () => {
    givenRound(['disposalEffPct'], {
      'player-1': { disposals: 10, disposal_efficiency: 70 },
      'player-2': { disposals: 0, disposal_efficiency: null },
    });

    const result = await recalculateLeagueRoundMatchups({ leagueId: 'league-1', round: 4 });

    expect(result).toMatchObject({ recalculated: 1 });
    expect(prismaMocks.$transaction).toHaveBeenCalledTimes(1);
  });

  it('holds the round when disposal efficiency is unreported for a player who had disposals', async () => {
    givenRound(['disposalEffPct'], {
      'player-1': { disposals: 10, disposal_efficiency: 70 },
      'player-2': { disposals: 12 },
    });

    const result = await recalculateLeagueRoundMatchups({ leagueId: 'league-1', round: 4 });

    expect(result).toMatchObject({ recalculated: 0, missingPlayerIds: ['player-2'] });
    expect(prismaMocks.$transaction).not.toHaveBeenCalled();
  });
});
