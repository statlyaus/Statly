import { beforeEach, describe, expect, it, vi } from 'vitest';

const etlMocks = vi.hoisted(() => ({
  getRoundPlayerStatsResult: vi.fn().mockResolvedValue({ ok: true, stats: [] }),
  getRoundMatchesResult: vi.fn().mockResolvedValue({ ok: true, matches: [] }),
}));

const prismaMocks = vi.hoisted(() => ({
  $transaction: vi.fn(),
  league: { findUnique: vi.fn() },
  leagueCompetitionRound: { findUnique: vi.fn() },
  leagueMatchup: { findMany: vi.fn(), update: vi.fn() },
  leagueMatchupScore: { upsert: vi.fn() },
  leagueLineup: { findMany: vi.fn() },
  leagueMember: { findMany: vi.fn() },
}));
const carryForwardMock = vi.hoisted(() => vi.fn().mockResolvedValue(0));

vi.mock('@/server/etl/etlRoundData', () => etlMocks);
vi.mock('@/lib/prisma', () => ({ prisma: prismaMocks }));
vi.mock('@/server/leagues/defaultLineups', () => ({
  ensureDefaultLineups: carryForwardMock,
}));

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
    prismaMocks.leagueMatchup.findMany.mockResolvedValue([
      { id: 'matchup-1', homeMemberId: 'member-1', awayMemberId: 'member-2' },
    ]);
    prismaMocks.leagueLineup.findMany.mockResolvedValue([
      {
        id: 'lineup-1',
        memberId: 'member-1',
        players: [
          { id: 'a-1', playerId: 'player-1', slot: 'MID', slotIndex: 0, player: { club: 'GWS' } },
        ],
      },
      {
        id: 'lineup-2',
        memberId: 'member-2',
        players: [
          { id: 'a-2', playerId: 'player-2', slot: 'MID', slotIndex: 0, player: { club: 'GWS' } },
        ],
      },
    ]);

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
    prismaMocks.leagueMatchup.findMany.mockResolvedValue([
      { id: 'matchup-1', homeMemberId: 'member-1', awayMemberId: 'member-2' },
    ]);
    prismaMocks.leagueLineup.findMany.mockResolvedValue([
      {
        id: 'lineup-1',
        memberId: 'member-1',
        players: [
          { id: 'a-1', playerId: 'player-1', slot: 'MID', slotIndex: 0, player: { club: 'GWS' } },
        ],
      },
      {
        id: 'lineup-2',
        memberId: 'member-2',
        players: [
          { id: 'a-2', playerId: 'player-2', slot: 'MID', slotIndex: 0, player: { club: 'GWS' } },
        ],
      },
    ]);

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

  it.each([
    {
      scenario: 'a participant with no lineup to carry forward',
      lineups: [{ id: 'lineup-1', memberId: 'member-1', players: [{ id: 'assignment-1' }] }],
    },
    {
      scenario: 'an empty participant lineup',
      lineups: [
        { id: 'lineup-1', memberId: 'member-1', players: [{ id: 'assignment-1' }] },
        { id: 'lineup-2', memberId: 'member-2', players: [] },
      ],
    },
  ])('does not load stats or score when the only matchup has $scenario', async ({ lineups }) => {
    prismaMocks.league.findUnique.mockResolvedValue(leagueWithFixtureVersion(7));
    prismaMocks.leagueCompetitionRound.findUnique.mockResolvedValue({ aflRound: 12 });
    prismaMocks.leagueMatchup.findMany.mockResolvedValue([
      {
        id: 'matchup-1',
        homeMemberId: 'member-1',
        awayMemberId: 'member-2',
      },
    ]);
    prismaMocks.leagueLineup.findMany.mockResolvedValue(lineups);

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
    expect(etlMocks.getRoundMatchesResult).not.toHaveBeenCalled();
    expect(etlMocks.getRoundPlayerStatsResult).not.toHaveBeenCalled();
    expect(prismaMocks.$transaction).not.toHaveBeenCalled();
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
      {
        id: 'lineup-1',
        memberId: 'member-1',
        players: [
          {
            id: 'assignment-1',
            playerId: 'player-1',
            slot: 'MID',
            slotIndex: 0,
            player: { club: 'GWS' },
          },
        ],
      },
      {
        id: 'lineup-2',
        memberId: 'member-2',
        players: [
          {
            id: 'assignment-2',
            playerId: 'player-2',
            slot: 'MID',
            slotIndex: 0,
            player: { club: 'GWS' },
          },
        ],
      },
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
      matches: [
        {
          match_uid: 'afl-match-1',
          status: 'final',
          home_team: 'GWS Giants',
          away_team: 'Collingwood',
        },
      ],
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

  it('carries lineups forward for every matchup participant before scoring', async () => {
    prismaMocks.league.findUnique.mockResolvedValue(leagueWithFixtureVersion(7));
    prismaMocks.leagueCompetitionRound.findUnique.mockResolvedValue({ aflRound: 12 });
    prismaMocks.leagueMatchup.findMany.mockResolvedValue([
      { id: 'matchup-1', homeMemberId: 'member-1', awayMemberId: 'member-2' },
      { id: 'matchup-2', homeMemberId: 'member-3', awayMemberId: null, byeMemberId: 'member-3' },
    ]);

    await recalculateLeagueRoundMatchups({ leagueId: 'league-1', round: 4 });

    expect(carryForwardMock).toHaveBeenCalledWith({
      leagueId: 'league-1',
      round: 4,
      memberIds: ['member-1', 'member-2'],
    });
  });

  it('scores the matchups that have lineups when another matchup is missing one', async () => {
    prismaMocks.league.findUnique.mockResolvedValue(leagueWithFixtureVersion(7));
    prismaMocks.leagueCompetitionRound.findUnique.mockResolvedValue({ aflRound: 12 });
    prismaMocks.leagueMatchup.findMany.mockResolvedValue([
      { id: 'matchup-1', homeMemberId: 'member-1', awayMemberId: 'member-2' },
      { id: 'matchup-2', homeMemberId: 'member-3', awayMemberId: 'member-4' },
    ]);
    const lineup = (memberId: string, playerId: string) => ({
      id: `lineup-${memberId}`,
      memberId,
      players: [
        { id: `a-${playerId}`, playerId, slot: 'MID', slotIndex: 0, player: { club: 'GWS' } },
      ],
    });
    prismaMocks.leagueLineup.findMany.mockResolvedValue([
      lineup('member-1', 'player-1'),
      lineup('member-2', 'player-2'),
      lineup('member-3', 'player-3'),
    ]);
    etlMocks.getRoundPlayerStatsResult.mockResolvedValue({
      ok: true,
      stats: ['player-1', 'player-2'].map((playerUid) => ({
        player_uid: playerUid,
        round_number: 12,
        status: 'live',
        stats: { goals: playerUid === 'player-1' ? 2 : 1 },
      })),
    });
    etlMocks.getRoundMatchesResult.mockResolvedValue({
      ok: true,
      matches: [
        {
          match_uid: 'afl-match-1',
          status: 'scheduled',
          home_team: 'GWS Giants',
          away_team: 'Collingwood',
        },
      ],
    });

    const result = await recalculateLeagueRoundMatchups({ leagueId: 'league-1', round: 4 });

    expect(result).toMatchObject({ round: 4, recalculated: 1 });
    expect(prismaMocks.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMocks.leagueMatchup.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'matchup-1' } })
    );
  });
});
