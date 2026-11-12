/**
 * A FINAL round may be rescored (stat corrections), but every change to its stored results is
 * recorded with before and after (process-map finding roster-scoring-11, owner decision 2026-11-11).
 * A commissioner cannot finalize a round before all of its AFL matches are final.
 */
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
    leagueCompetitionRound: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
    leagueCompetitionAudit: { create: vi.fn() },
    leagueMatchup: { findMany: vi.fn(), update: vi.fn() },
    leagueMatchupScore: { upsert: vi.fn(), findMany: vi.fn() },
    leagueStanding: { upsert: vi.fn() },
    leagueLineup: { findMany: vi.fn() },
    leagueMember: { findMany: vi.fn() },
    playerExternalIdentity: { findMany: vi.fn() },
  };
  mocks.$transaction.mockImplementation((work: (tx: typeof mocks) => unknown) => work(mocks));
  return mocks;
});

vi.mock('server-only', () => ({}));
vi.mock('@/server/etl/etlRoundData', () => etlMocks);
vi.mock('@/lib/prisma', () => ({ prisma: prismaMocks }));
vi.mock('@/server/leagues/defaultLineups', () => ({
  ensureDefaultLineups: vi.fn().mockResolvedValue(0),
}));

import { changedFinalMatchups } from '@/server/leagues/finalRoundRescoreAudit';
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
    competitionStatus: 'ACTIVE',
    competitionRulesJson: null,
    competitionRulesVersion: 7,
  },
};

const matchup = {
  id: 'matchup-1',
  homeMemberId: 'member-1',
  awayMemberId: 'member-2',
  status: 'FINAL',
};

/** The stored FINAL result: member-1 won goals 2 to 1. */
function storedFinalResult({ homeGoals, awayGoals }: { homeGoals: number; awayGoals: number }) {
  const homeWon = homeGoals > awayGoals;
  return {
    ...matchup,
    winnerMemberId: homeWon ? 'member-1' : 'member-2',
    homeCategoryWins: homeWon ? 1 : 0,
    awayCategoryWins: homeWon ? 0 : 1,
    drawnCategories: 0,
    scores: [
      {
        memberId: 'member-1',
        pointsFor: homeGoals,
        // Postgres jsonb reorders keys; the comparison must not care.
        categoriesJson: [
          {
            winner: homeWon ? 'home' : 'away',
            direction: 'HIGH_WINS',
            category: 'goals',
            homeValue: homeGoals,
            awayValue: awayGoals,
          },
        ],
      },
      {
        memberId: 'member-2',
        pointsFor: awayGoals,
        categoriesJson: [
          {
            winner: homeWon ? 'away' : 'home',
            direction: 'HIGH_WINS',
            category: 'goals',
            homeValue: awayGoals,
            awayValue: homeGoals,
          },
        ],
      },
    ],
  };
}

function givenRound({
  homeGoals,
  awayGoals,
  matchStatus = 'final',
  stored,
}: {
  homeGoals: number;
  awayGoals: number;
  matchStatus?: string;
  stored: ReturnType<typeof storedFinalResult>;
}) {
  prismaMocks.league.findUnique.mockResolvedValue(league);
  prismaMocks.leagueCompetitionRound.findUnique.mockResolvedValue({ aflRound: 12 });
  // First read: the round's matchups. Second read, inside the transaction: the stored results.
  prismaMocks.leagueMatchup.findMany
    .mockResolvedValueOnce([matchup])
    .mockResolvedValueOnce([stored]);
  prismaMocks.leagueLineup.findMany.mockResolvedValue(
    ['member-1', 'member-2'].map((memberId, index) => ({
      id: `lineup-${memberId}`,
      memberId,
      players: [
        {
          id: `a-${index}`,
          playerId: `player-${index}`,
          slot: 'MID',
          slotIndex: 0,
          player: { club: 'GWS' },
        },
      ],
    }))
  );
  prismaMocks.leagueMember.findMany.mockResolvedValue(
    ['member-1', 'member-2'].map((id) => ({ id, teamName: id }))
  );
  etlMocks.getRoundPlayerStatsResult.mockResolvedValue({
    ok: true,
    stats: [homeGoals, awayGoals].map((goals, index) => ({
      player_uid: `player-${index}`,
      round_number: 12,
      status: matchStatus,
      stats: { minutes: 80, goals },
    })),
  });
  etlMocks.getRoundMatchesResult.mockResolvedValue({
    ok: true,
    matches: [{ match_uid: 'afl-1', status: matchStatus, home_team: 'GWS', away_team: 'Geelong' }],
  });
}

describe('rescoring a FINAL round', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.leagueMatchup.findMany.mockReset();
    prismaMocks.leagueMatchupScore.findMany.mockResolvedValue([]);
    prismaMocks.leagueCompetitionRound.count.mockResolvedValue(1);
    prismaMocks.playerExternalIdentity.findMany.mockResolvedValue([]);
  });

  it('records one audit row per changed matchup, with before and after, in the scoring transaction', async () => {
    // Stored: member-1 won 2 to 1. A stat correction makes it 2 to 3.
    givenRound({
      homeGoals: 2,
      awayGoals: 3,
      stored: storedFinalResult({ homeGoals: 2, awayGoals: 1 }),
    });

    const result = await recalculateLeagueRoundMatchups({
      leagueId: 'league-1',
      round: 4,
      actorMemberId: 'member-1',
    });

    expect(result).toMatchObject({ status: 'FINAL', recalculated: 1 });
    expect(prismaMocks.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMocks.leagueMatchup.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { leagueId: 'league-1', id: { in: ['matchup-1'] }, status: 'FINAL' },
      })
    );
    expect(prismaMocks.leagueCompetitionAudit.create).toHaveBeenCalledTimes(1);
    const { data } = prismaMocks.leagueCompetitionAudit.create.mock.calls[0][0];
    expect(data).toMatchObject({
      leagueId: 'league-1',
      actorMemberId: 'member-1',
      eventType: 'FINAL_ROUND_RESCORED',
      payloadJson: {
        seasonId: 'season-1',
        round: 4,
        matchupId: 'matchup-1',
        trigger: 'manual',
        before: { status: 'FINAL', winnerMemberId: 'member-1', homeCategoryWins: 1 },
        after: { status: 'FINAL', winnerMemberId: 'member-2', homeCategoryWins: 0 },
      },
    });
    expect(data.payloadJson.after.scores).toEqual([
      expect.objectContaining({ memberId: 'member-1', pointsFor: 2 }),
      expect.objectContaining({ memberId: 'member-2', pointsFor: 3 }),
    ]);
    // The audit is written after the lock and before the standings.
    const [auditCall] = prismaMocks.leagueCompetitionAudit.create.mock.invocationCallOrder;
    expect(auditCall).toBeGreaterThan(prismaMocks.$executeRaw.mock.invocationCallOrder[0]);
    expect(auditCall).toBeLessThan(
      Math.min(...prismaMocks.leagueStanding.upsert.mock.invocationCallOrder)
    );
    // The ladder is still recomputed from the corrected round.
    expect(prismaMocks.leagueStanding.upsert).toHaveBeenCalledTimes(2);
  });

  it('marks a recalculation with no commissioner as the scheduled job', async () => {
    givenRound({
      homeGoals: 2,
      awayGoals: 3,
      stored: storedFinalResult({ homeGoals: 2, awayGoals: 1 }),
    });

    await recalculateLeagueRoundMatchups({ leagueId: 'league-1', round: 4, finalize: false });

    const { data } = prismaMocks.leagueCompetitionAudit.create.mock.calls[0][0];
    expect(data.actorMemberId).toBeNull();
    expect(data.payloadJson.trigger).toBe('cron');
  });

  it('marks a re-score caused by a corrected AFL result as the system, with the corrections (#1295)', async () => {
    givenRound({
      homeGoals: 2,
      awayGoals: 3,
      stored: storedFinalResult({ homeGoals: 2, awayGoals: 1 }),
    });
    const resultCorrections = [
      { supersededResultId: 'result-a', currentResultId: 'result-b', reason: 'score changed' },
    ];

    await recalculateLeagueRoundMatchups({
      leagueId: 'league-1',
      round: 4,
      finalize: false,
      resultCorrections,
    });

    const { data } = prismaMocks.leagueCompetitionAudit.create.mock.calls[0][0];
    expect(data.actorMemberId).toBeNull();
    expect(data.payloadJson).toMatchObject({ trigger: 'result-correction', resultCorrections });
  });

  it('writes no audit row when the recalculation reproduces the stored result', async () => {
    givenRound({
      homeGoals: 2,
      awayGoals: 1,
      stored: storedFinalResult({ homeGoals: 2, awayGoals: 1 }),
    });

    const result = await recalculateLeagueRoundMatchups({ leagueId: 'league-1', round: 4 });

    expect(result).toMatchObject({ status: 'FINAL', recalculated: 1 });
    expect(prismaMocks.leagueCompetitionAudit.create).not.toHaveBeenCalled();
  });

  it('refuses to finalize a round whose AFL matches are not all final', async () => {
    givenRound({
      homeGoals: 2,
      awayGoals: 1,
      matchStatus: 'live',
      stored: storedFinalResult({ homeGoals: 2, awayGoals: 1 }),
    });
    prismaMocks.leagueMatchup.findMany.mockReset();
    prismaMocks.leagueMatchup.findMany.mockResolvedValue([{ ...matchup, status: 'LIVE' }]);

    const result = await recalculateLeagueRoundMatchups({
      leagueId: 'league-1',
      round: 4,
      finalize: true,
      actorMemberId: 'member-1',
    });

    expect(result).toMatchObject({ blocked: 'AFL_MATCHES_NOT_FINAL', recalculated: 0 });
    expect(prismaMocks.$transaction).not.toHaveBeenCalled();
  });
});

describe('changedFinalMatchups', () => {
  const stored = storedFinalResult({ homeGoals: 2, awayGoals: 1 });
  const snapshot = {
    status: stored.status,
    winnerMemberId: stored.winnerMemberId,
    homeCategoryWins: stored.homeCategoryWins,
    awayCategoryWins: stored.awayCategoryWins,
    drawnCategories: stored.drawnCategories,
    scores: stored.scores,
  };

  it('ignores key order and score row order', () => {
    const reordered = {
      ...snapshot,
      scores: [...snapshot.scores].reverse().map((score) => ({
        ...score,
        categoriesJson: (score.categoriesJson as Array<Record<string, unknown>>).map((row) =>
          Object.fromEntries(Object.entries(row).reverse())
        ),
      })),
    };

    expect(changedFinalMatchups(new Map([['m', snapshot]]), new Map([['m', reordered]]))).toEqual(
      []
    );
  });

  it('only compares matchups that were FINAL before', () => {
    const changed = { ...snapshot, winnerMemberId: 'member-2' };

    expect(changedFinalMatchups(new Map(), new Map([['m', changed]]))).toEqual([]);
    expect(changedFinalMatchups(new Map([['m', snapshot]]), new Map([['m', changed]]))).toEqual([
      { matchupId: 'm', before: snapshot, after: changed },
    ]);
  });
});
