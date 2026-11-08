import { beforeEach, describe, expect, it, vi } from 'vitest';

const etlMocks = vi.hoisted(() => ({
  getRoundPlayerStatsResult: vi.fn(),
  getRoundMatchesResult: vi.fn(),
}));

const prismaMocks = vi.hoisted(() => {
  const mocks = {
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    league: { findUnique: vi.fn() },
    player: { findMany: vi.fn() },
    leagueCompetitionRound: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
    leagueMatchup: { findMany: vi.fn(), update: vi.fn() },
    leagueMatchupScore: { upsert: vi.fn(), findMany: vi.fn() },
    leagueStanding: { upsert: vi.fn() },
    leagueLineup: { findMany: vi.fn(), findFirst: vi.fn() },
    leagueLineupPlayer: { findMany: vi.fn(), updateMany: vi.fn() },
    leagueLineupAutosub: { create: vi.fn() },
    leagueCompetitionAudit: { create: vi.fn() },
    leagueMember: { findMany: vi.fn() },
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

const league = {
  id: 'league-1',
  activeSeasonId: 'season-1',
  categoriesJson: ['goals'],
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

function assignment(playerId: string, club: string, slot: 'MID' | 'INTERCHANGE') {
  return {
    id: `a-${playerId}`,
    playerId,
    slot,
    slotIndex: 0,
    player: { club, position: 'MID' },
  };
}

// member-1 starts a GWS midfielder his club did not select; a Collingwood midfielder waits on
// the interchange. member-2 starts a Collingwood midfielder.
const lineups = [
  {
    id: 'lineup-1',
    memberId: 'member-1',
    players: [
      assignment('unselected', 'GWS', 'MID'),
      assignment('sub', 'Collingwood', 'INTERCHANGE'),
    ],
  },
  { id: 'lineup-2', memberId: 'member-2', players: [assignment('opponent', 'Collingwood', 'MID')] },
];

function statRow(playerUid: string, team: string, goals: number, matchUid = '2026-R12-GWS-COL') {
  return {
    match_uid: matchUid,
    player_uid: playerUid,
    team,
    round: 12,
    stats: { minutes: 80, goals },
  };
}

function givenRound({
  status = 'final',
  stats,
  statlyPlayerIds,
  confirmedByeTeams,
}: {
  status?: string;
  stats: ReturnType<typeof statRow>[];
  statlyPlayerIds: string[];
  confirmedByeTeams?: string[];
}) {
  etlMocks.getRoundMatchesResult.mockResolvedValue({
    ok: true,
    matches: [
      {
        match_uid: '2026-R12-GWS-COL',
        home_team: 'GWS Giants',
        away_team: 'Collingwood',
        status,
        ...(confirmedByeTeams ? { confirmed_bye_teams: confirmedByeTeams } : {}),
      },
    ],
  });
  etlMocks.getRoundPlayerStatsResult.mockResolvedValue({ ok: true, stats });
  prismaMocks.player.findMany.mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
    Promise.resolve(where.id.in.filter((id) => statlyPlayerIds.includes(id)).map((id) => ({ id })))
  );
}

function expectNothingWritten(result: unknown) {
  expect(result).toMatchObject({ status: 'SCHEDULED', recalculated: 0, scores: [] });
  expect(prismaMocks.$transaction).not.toHaveBeenCalled();
  expect(prismaMocks.leagueMatchup.update).not.toHaveBeenCalled();
  expect(prismaMocks.leagueLineupAutosub.create).not.toHaveBeenCalled();
}

describe('a lineup player his club did not select', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.league.findUnique.mockResolvedValue(league);
    prismaMocks.leagueCompetitionRound.findUnique.mockResolvedValue({
      aflRound: 12,
      season: { year: 2026 },
    });
    prismaMocks.leagueCompetitionRound.count.mockResolvedValue(1);
    prismaMocks.leagueMatchup.findMany.mockResolvedValue([
      { id: 'matchup-1', homeMemberId: 'member-1', awayMemberId: 'member-2' },
    ]);
    prismaMocks.leagueMatchupScore.findMany.mockResolvedValue([]);
    prismaMocks.leagueMember.findMany.mockResolvedValue(
      ['member-1', 'member-2'].map((id) => ({ id, teamName: id }))
    );
    prismaMocks.leagueLineup.findMany.mockResolvedValue(lineups);
    prismaMocks.leagueLineup.findFirst.mockResolvedValue({ id: 'lineup-1' });
    prismaMocks.leagueLineupPlayer.findMany.mockResolvedValue(
      lineups[0].players.map(({ id, playerId, slot, slotIndex }) => ({
        id,
        playerId,
        slot,
        slotIndex,
      }))
    );
    prismaMocks.leagueLineupPlayer.updateMany.mockResolvedValue({ count: 1 });
  });

  it('did not play once his final match has mapped rows for his club, so the round finalizes and the autosub runs', async () => {
    givenRound({
      stats: [
        statRow('gws-clubmate', 'GWS Giants', 0),
        statRow('sub', 'Collingwood', 3),
        statRow('opponent', 'Collingwood', 1),
      ],
      statlyPlayerIds: ['gws-clubmate', 'sub', 'opponent'],
    });

    const result = await recalculateLeagueRoundMatchups({
      leagueId: 'league-1',
      round: 4,
      finalize: true,
    });

    expect(result).toMatchObject({ status: 'FINAL', recalculated: 1 });
    expect(prismaMocks.leagueLineupAutosub.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        lineupId: 'lineup-1',
        outgoingPlayerId: 'unselected',
        replacementPlayerId: 'sub',
        reason: 'DID_NOT_PLAY',
      }),
    });
    // The interchange player's three goals now count for member-1.
    expect(prismaMocks.leagueMatchup.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'matchup-1' },
        data: expect.objectContaining({ status: 'FINAL', winnerMemberId: 'member-1' }),
      })
    );
  });

  it('keeps the round waiting while his club match is not final', async () => {
    givenRound({
      status: 'in_progress',
      stats: [
        statRow('gws-clubmate', 'GWS Giants', 0),
        statRow('sub', 'Collingwood', 3),
        statRow('opponent', 'Collingwood', 1),
      ],
      statlyPlayerIds: ['gws-clubmate', 'sub', 'opponent'],
    });

    expectNothingWritten(
      await recalculateLeagueRoundMatchups({ leagueId: 'league-1', round: 4, finalize: true })
    );
  });

  it('keeps the round waiting when none of his club rows in the final match reach a Statly player', async () => {
    givenRound({
      stats: [
        statRow('gws-clubmate', 'GWS Giants', 0),
        statRow('sub', 'Collingwood', 3),
        statRow('opponent', 'Collingwood', 1),
      ],
      statlyPlayerIds: ['sub', 'opponent'],
    });

    expectNothingWritten(
      await recalculateLeagueRoundMatchups({ leagueId: 'league-1', round: 4, finalize: true })
    );
  });

  it('does not count his club rows from another match', async () => {
    givenRound({
      stats: [
        statRow('gws-clubmate', 'GWS Giants', 0, '2026-R11-GWS-ESS'),
        statRow('sub', 'Collingwood', 3),
        statRow('opponent', 'Collingwood', 1),
      ],
      statlyPlayerIds: ['gws-clubmate', 'sub', 'opponent'],
    });

    expectNothingWritten(
      await recalculateLeagueRoundMatchups({ leagueId: 'league-1', round: 4, finalize: true })
    );
  });

  it('never finalizes a round of zeros while ETL ids reach no Statly player', async () => {
    givenRound({
      stats: [
        statRow('ply_gws_one', 'GWS Giants', 2),
        statRow('ply_col_one', 'Collingwood', 3),
        statRow('ply_col_two', 'Collingwood', 1),
      ],
      statlyPlayerIds: [],
    });

    expectNothingWritten(
      await recalculateLeagueRoundMatchups({ leagueId: 'league-1', round: 4, finalize: true })
    );
  });

  it('still subs off a player whose club has a confirmed bye', async () => {
    prismaMocks.leagueLineup.findMany.mockResolvedValue([
      {
        ...lineups[0],
        players: [
          assignment('unselected', 'Richmond', 'MID'),
          assignment('sub', 'Collingwood', 'INTERCHANGE'),
        ],
      },
      lineups[1],
    ]);
    givenRound({
      stats: [statRow('sub', 'Collingwood', 3), statRow('opponent', 'Collingwood', 1)],
      statlyPlayerIds: ['sub', 'opponent'],
      confirmedByeTeams: ['Richmond Tigers'],
    });

    const result = await recalculateLeagueRoundMatchups({
      leagueId: 'league-1',
      round: 4,
      finalize: true,
    });

    expect(result).toMatchObject({ status: 'FINAL', recalculated: 1 });
    expect(prismaMocks.leagueLineupAutosub.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ outgoingPlayerId: 'unselected', reason: 'CLUB_BYE' }),
    });
    expect(prismaMocks.player.findMany).not.toHaveBeenCalled();
  });
});
