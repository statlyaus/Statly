/**
 * No Losers scoring on PostgreSQL (#1294, epic #1290 BR-07, BR-08, BR-21): a counted player's stats
 * are multiplied by his club's stored result, joined by matchUid and club abbreviation; the round
 * cannot be FINAL while a result is missing; the stored per-player rows re-derive the team totals.
 * Standard and Bloodsucker leagues score exactly as before (golden). A corrected result re-scores
 * the FINAL round it was used in, with audit (#1295, BR-23); an unchanged re-ingest triggers nothing.
 */
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const GAMES = [
  { match_uid: '2091-R5-GWS-GEE', home_team: 'GWS', away_team: 'Geelong', status: 'final' },
  {
    match_uid: '2091-R5-HAW-COL',
    home_team: 'Hawthorn',
    away_team: 'Collingwood',
    status: 'final',
  },
];
// Provider club spellings deliberately differ from the result rows' canonical names (BR-07).
const STAT_ROWS = [
  {
    player_uid: 'int-nl-p1',
    match_uid: GAMES[0].match_uid,
    team: 'GWS Giants',
    team_abbr: 'GWS',
    stats: { goals: 4, tackles: 5, clangers: 2 },
  },
  {
    player_uid: 'int-nl-p2',
    match_uid: GAMES[1].match_uid,
    team: 'Hawks',
    team_abbr: 'HAW',
    stats: { goals: 2, tackles: 2, clangers: 4 },
  },
  {
    player_uid: 'int-nl-p3',
    match_uid: GAMES[0].match_uid,
    team: 'Geelong Cats',
    team_abbr: 'GEE',
    stats: { goals: 1, tackles: 2, clangers: 3 },
  },
  {
    player_uid: 'int-nl-p4',
    match_uid: GAMES[1].match_uid,
    team: 'Magpies',
    team_abbr: 'COL',
    stats: { goals: 1, tackles: 2, clangers: 1 },
  },
];

vi.mock('@/server/etl/etlRoundData', () => ({
  getRoundMatches: vi.fn().mockResolvedValue([]),
  getRoundMatchesResult: vi.fn(() => Promise.resolve({ ok: true, matches: GAMES })),
  getRoundPlayerStatsResult: vi.fn(() =>
    Promise.resolve({
      ok: true,
      stats: STAT_ROWS.map((row) => ({
        ...row,
        round_number: 5,
        stats: { minutes: 80, ...row.stats },
      })),
    })
  ),
}));

import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { recalculateLeagueRoundMatchups } from '@/server/leagues/matchupReadModel';
import { aggregateLineupCategoryTotals } from '@/server/leagues/matchupScoringEngine';
import { rescoreCorrectedResultRounds } from '@/server/leagues/noLosersResultCorrections';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';

import { ingestResultRows, type ResultSourceRow } from '../../etl/resultIngest';
import { pgResultStore } from '../../etl/resultStore';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';

const LEAGUE = 'int-nl-league';
const SETTINGS = 'int-nl-settings';
const USERS = ['int-nl-owner', 'int-nl-rival'];
const SEASON = 'int-nl-season';
const MEMBERS = ['int-nl-m1', 'int-nl-m2'];
const PLAYERS = STAT_ROWS.map((row) => row.player_uid);
const CATEGORIES: FantasyCategoryKey[] = ['goals', 'tackles', 'clangers'];
const ROUND = 1;
const AFL_SEASON = 2091;

const removeFixture = async () => {
  await deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE],
    playerIds: PLAYERS,
    settingsIds: [SETTINGS],
    userIds: USERS,
  });
  await prisma.aflMatchResult.deleteMany({ where: { season: AFL_SEASON } });
};

async function storeResult(index: number, homePoints: number, awayPoints: number) {
  const [, , home, away] = GAMES[index].match_uid.split('-');
  const clubs: Record<string, string> = {
    GWS: 'Greater Western Sydney',
    GEE: 'Geelong',
    HAW: 'Hawthorn',
    COL: 'Collingwood',
  };
  return prisma.aflMatchResult.create({
    data: {
      season: AFL_SEASON,
      round: 5,
      matchId: `fw-${index}`,
      matchUid: GAMES[index].match_uid,
      homeClub: clubs[home],
      awayClub: clubs[away],
      homePoints,
      awayPoints,
      margin: homePoints - awayPoints,
      status: 'FINAL',
      fetchedAt: new Date('2091-04-20T00:00:00.000Z'),
      contentHash: `hash-${index}-${homePoints}-${awayPoints}`,
    },
  });
}

async function seedLeague(input: {
  leagueFormat: 'STANDARD' | 'BLOODSUCKER' | 'NO_LOSERS';
  scoringMode: 'H2H_EACH_CATEGORY' | 'H2H_MOST_CATEGORIES';
}) {
  await removeFixture();
  for (const id of USERS) {
    await prisma.user.create({
      data: { id, email: `${id}@statly.local`, passwordHash: 'x', displayName: id },
    });
  }
  await prisma.leagueSettings.create({
    data: {
      id: SETTINGS,
      rosterSize: 2,
      benchSize: 0,
      maxTeams: 2,
      pickSeconds: 120,
      allowAutoPick: true,
      draftType: 'SNAKE',
      pickOrder: 'MANUAL',
      waiverRule: 'ROLLING',
      timeZone: 'Australia/Melbourne',
      locked: false,
      competitionRulesVersion: 1,
      competitionStatus: 'ACTIVE',
      leagueFormat: input.leagueFormat,
      scoringMode: input.scoringMode,
      // Low-wins clangers: a loser's clangers are zeroed too (BR-11).
      categoryDirectionsJson: { clangers: 'LOW_WINS' },
    },
  });
  await prisma.league.create({
    data: {
      id: LEAGUE,
      name: 'No Losers',
      inviteCode: 'INTNOLO',
      ownerId: USERS[0],
      settingsId: SETTINGS,
      categoriesJson: CATEGORIES,
    },
  });
  await prisma.leagueSeason.create({
    data: { id: SEASON, leagueId: LEAGUE, label: `${AFL_SEASON} season`, year: AFL_SEASON },
  });
  await prisma.league.update({ where: { id: LEAGUE }, data: { activeSeasonId: SEASON } });
  for (const [index, id] of MEMBERS.entries()) {
    await prisma.leagueMember.create({
      data: {
        id,
        leagueId: LEAGUE,
        userId: USERS[index],
        role: index === 0 ? 'OWNER' : 'MANAGER',
        teamName: id,
      },
    });
    const owned = PLAYERS.slice(index * 2, index * 2 + 2);
    for (const playerId of owned) {
      await prisma.player.create({
        data: { id: playerId, name: playerId, club: 'GWS', position: 'MID' },
      });
    }
    await prisma.leagueLineup.create({
      data: {
        leagueId: LEAGUE,
        seasonId: SEASON,
        memberId: id,
        round: ROUND,
        players: {
          create: owned.map((playerId, slotIndex) => ({ playerId, slot: 'MID', slotIndex })),
        },
      },
    });
  }
  const competitionRound = await prisma.leagueCompetitionRound.create({
    data: {
      leagueId: LEAGUE,
      seasonId: SEASON,
      fixtureVersion: 1,
      round: ROUND,
      aflRound: 5,
      status: 'LOCKED',
      publishedAt: new Date('2091-02-01T00:00:00.000Z'),
    },
  });
  const matchup = await prisma.leagueMatchup.create({
    data: {
      leagueId: LEAGUE,
      round: ROUND,
      fixtureVersion: 1,
      competitionRoundId: competitionRound.id,
      homeMemberId: MEMBERS[0],
      awayMemberId: MEMBERS[1],
    },
  });
  return matchup.id;
}

const homeScore = (matchupId: string) =>
  prisma.leagueMatchupScore.findUniqueOrThrow({
    where: { matchupId_memberId: { matchupId, memberId: MEMBERS[0] } },
  });

const pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST, max: 2 });

afterAll(async () => {
  await removeFixture();
  await pool.end();
});

describe.each(['H2H_EACH_CATEGORY', 'H2H_MOST_CATEGORIES'] as const)(
  'a No Losers league scored %s',
  (scoringMode) => {
    let matchupId: string;

    beforeEach(async () => {
      matchupId = await seedLeague({ leagueFormat: 'NO_LOSERS', scoringMode });
    });

    it('counts each player by his club result, joined by abbreviation, and stores the breakdown', async () => {
      // GWS lose by 20 (p1 zeroed), Geelong win (p3 full); Hawthorn lose by 3 (p2 half), Collingwood win.
      const gwsGee = await storeResult(0, 80, 100);
      const hawCol = await storeResult(1, 70, 73);

      await expect(
        recalculateLeagueRoundMatchups({ leagueId: LEAGUE, round: ROUND })
      ).resolves.toMatchObject({ status: 'FINAL', recalculated: 1, waitingOnResults: [] });

      const matchup = await prisma.leagueMatchup.findUniqueOrThrow({ where: { id: matchupId } });
      // Raw stats would give the home side goals and tackles; counted, the away side takes both.
      expect(matchup.winnerMemberId).toBe(MEMBERS[1]);
      const rows = await prisma.leagueMatchupPlayerScore.findMany({
        where: { matchupId },
        orderBy: { playerId: 'asc' },
      });
      expect(
        rows.map((row) => [
          row.playerId,
          row.outcome,
          row.clubResult,
          row.margin,
          row.multiplier,
          row.aflMatchResultId,
        ])
      ).toEqual([
        ['int-nl-p1', 'RESULT', 'LOSS', -20, 0, gwsGee.id],
        ['int-nl-p2', 'RESULT', 'LOSS', -3, 0.5, hawCol.id],
        ['int-nl-p3', 'RESULT', 'WIN', 20, 1, gwsGee.id],
        ['int-nl-p4', 'RESULT', 'WIN', 3, 1, hawCol.id],
      ]);
      expect(rows.every((row) => row.ruleVersion === 'no-losers-result-rule/v1')).toBe(true);

      // BR-21: the stored per-player breakdown re-derives the stored team score.
      const score = await homeScore(matchupId);
      const rederived = aggregateLineupCategoryTotals({
        categories: CATEGORIES,
        players: rows
          .filter((row) => row.memberId === MEMBERS[0])
          .map((row) => ({
            playerId: row.playerId,
            slot: row.slot,
            totals: row.countedTotalsJson as Record<string, number>,
          })),
      });
      const stored = Object.fromEntries(
        (score.categoriesJson as Array<{ category: string; homeValue: number }>).map((row) => [
          row.category,
          row.homeValue,
        ])
      );
      expect(stored).toEqual({ goals: 1, tackles: 1, clangers: 2 });
      expect(CATEGORIES.map((category) => rederived[category])).toEqual([1, 1, 2]);
      expect(score.pointsFor).toBe(4);
    });

    it("joins a result whose home/away order differs from the stats feed's (#1315)", async () => {
      // Footywire's match page lists Geelong at home; the fixture and stat rows list GWS.
      await ingestResultRows(
        footywireRows([80, 100], [70, 73]).map((row, index) =>
          index === 0
            ? {
                ...row,
                home_team: row.away_team,
                away_team: row.home_team,
                home_points: row.away_points,
                away_points: row.home_points,
              }
            : row
        ),
        { store: pgResultStore(pool), fetchedAt: new Date() }
      );
      await expect(
        prisma.aflMatchResult.findFirstOrThrow({ where: { season: AFL_SEASON, matchId: '95001' } })
      ).resolves.toMatchObject({ matchUid: '2091-R5-GEE-GWS', homeClub: 'Geelong' });

      await expect(
        recalculateLeagueRoundMatchups({ leagueId: LEAGUE, round: ROUND })
      ).resolves.toMatchObject({ status: 'FINAL', recalculated: 1, waitingOnResults: [] });
      const p1 = await prisma.leagueMatchupPlayerScore.findFirstOrThrow({
        where: { matchupId, playerId: 'int-nl-p1' },
      });
      expect(p1).toMatchObject({ outcome: 'RESULT', clubResult: 'LOSS', margin: -20 });
    });

    it('stays LIVE and names the game while a result is missing, and refuses a finalize', async () => {
      await storeResult(0, 80, 100);

      await expect(
        recalculateLeagueRoundMatchups({ leagueId: LEAGUE, round: ROUND })
      ).resolves.toMatchObject({
        status: 'LIVE',
        waitingOnResults: ['Waiting on the result of Hawthorn v Collingwood'],
      });
      const round = await prisma.leagueCompetitionRound.findFirstOrThrow({
        where: { leagueId: LEAGUE },
      });
      expect(round.status).toBe('LOCKED');
      const pending = await prisma.leagueMatchupPlayerScore.findMany({
        where: { matchupId, outcome: 'RESULT_PENDING' },
        select: { playerId: true, multiplier: true },
        orderBy: { playerId: 'asc' },
      });
      expect(pending).toEqual([
        { playerId: 'int-nl-p2', multiplier: null },
        { playerId: 'int-nl-p4', multiplier: null },
      ]);

      await expect(
        recalculateLeagueRoundMatchups({
          leagueId: LEAGUE,
          round: ROUND,
          finalize: true,
          actorMemberId: MEMBERS[0],
        })
      ).resolves.toMatchObject({
        blocked: 'AFL_RESULTS_MISSING',
        waitingOnResults: ['Waiting on the result of Hawthorn v Collingwood'],
      });
    });
  }
);

describe.each(['STANDARD', 'BLOODSUCKER'] as const)('a %s league (golden)', (leagueFormat) => {
  it.each(['H2H_EACH_CATEGORY', 'H2H_MOST_CATEGORIES'] as const)(
    'scores %s on raw stats exactly as before, with no per-player rows',
    async (scoringMode) => {
      const matchupId = await seedLeague({ leagueFormat, scoringMode });
      await storeResult(0, 80, 100);
      await storeResult(1, 70, 73);

      const result = await recalculateLeagueRoundMatchups({ leagueId: LEAGUE, round: ROUND });

      expect(result).not.toHaveProperty('waitingOnResults');
      expect(result).toMatchObject({ status: 'FINAL', recalculated: 1 });
      const score = await homeScore(matchupId);
      expect(score.categoriesJson).toEqual([
        { category: 'goals', homeValue: 6, awayValue: 2, direction: 'HIGH_WINS', winner: 'home' },
        { category: 'tackles', homeValue: 7, awayValue: 4, direction: 'HIGH_WINS', winner: 'home' },
        { category: 'clangers', homeValue: 6, awayValue: 4, direction: 'LOW_WINS', winner: 'away' },
      ]);
      expect(score).toMatchObject({
        categoryWins: 2,
        categoryLosses: 1,
        categoryDraws: 0,
        pointsFor: 19,
        pointsAgainst: 10,
        matchupWin: true,
      });
      await expect(prisma.leagueMatchupPlayerScore.count({ where: { matchupId } })).resolves.toBe(
        0
      );
    }
  );
});

// Footywire rows for the round, ingested through the ETL's own store (etl/resultStore.ts).
function footywireRows(gwsGee: [number, number], hawCol: [number, number]): ResultSourceRow[] {
  const games: Array<[string, string, [number, number]]> = [
    ['GWS', 'Geelong', gwsGee],
    ['Hawthorn', 'Collingwood', hawCol],
  ];
  return games.map(([home, away, [homePoints, awayPoints]], index) => ({
    season: AFL_SEASON,
    match_id: String(95001 + index),
    round_label: 'Round 5',
    home_team: home,
    away_team: away,
    home_points: homePoints,
    away_points: awayPoints,
    date: '2091-04-20',
    last_home_and_away_round: 24,
  }));
}

describe('a corrected result in a FINAL No Losers round (#1295, BR-23)', () => {
  const ingest = (rows: ResultSourceRow[]) =>
    ingestResultRows(rows, { store: pgResultStore(pool), fetchedAt: new Date() });
  const rescoreAudits = () =>
    prisma.leagueCompetitionAudit.findMany({
      where: { leagueId: LEAGUE, eventType: 'FINAL_ROUND_RESCORED' },
    });
  let matchupId: string;

  beforeEach(async () => {
    // Most categories: a standings win is a matchup win.
    matchupId = await seedLeague({ leagueFormat: 'NO_LOSERS', scoringMode: 'H2H_MOST_CATEGORIES' });
    // GWS lose by 20 (p1 zeroed), Hawthorn lose by 3 (p2 half): the away side wins (as above).
    await ingest(footywireRows([80, 100], [70, 73]));
    await expect(
      recalculateLeagueRoundMatchups({ leagueId: LEAGUE, round: ROUND })
    ).resolves.toMatchObject({ status: 'FINAL' });
  });

  it('a flipped result re-scores the round: winner, standings, audit and change rows follow', async () => {
    await expect(
      prisma.leagueStanding.findFirstOrThrow({
        where: { leagueId: LEAGUE, memberId: MEMBERS[1] },
      })
    ).resolves.toMatchObject({ wins: 1, losses: 0 });

    // Footywire corrects GWS v Geelong: GWS won by 20, so p1 counts in full.
    await expect(ingest(footywireRows([100, 80], [70, 73]))).resolves.toMatchObject({
      superseded: 1,
      unchanged: 1,
    });
    const [superseded, current] = await Promise.all([
      prisma.aflMatchResult.findFirstOrThrow({
        where: { season: AFL_SEASON, matchId: '95001', supersededById: { not: null } },
      }),
      prisma.aflMatchResult.findFirstOrThrow({
        where: { season: AFL_SEASON, matchId: '95001', supersededById: null },
      }),
    ]);

    const run = await rescoreCorrectedResultRounds();

    expect(run).toEqual({
      rounds: [
        {
          leagueId: LEAGUE,
          round: ROUND,
          status: 'FINAL',
          recalculated: 1,
          correctedResultIds: [superseded.id],
        },
      ],
      pending: [],
      failedLeagueIds: [],
    });
    const matchup = await prisma.leagueMatchup.findUniqueOrThrow({ where: { id: matchupId } });
    expect(matchup).toMatchObject({ status: 'FINAL', winnerMemberId: MEMBERS[0] });
    await expect(
      prisma.leagueStanding.findFirstOrThrow({
        where: { leagueId: LEAGUE, memberId: MEMBERS[0] },
      })
    ).resolves.toMatchObject({ wins: 1, losses: 0 });
    await expect(
      prisma.leagueStanding.findFirstOrThrow({
        where: { leagueId: LEAGUE, memberId: MEMBERS[1] },
      })
    ).resolves.toMatchObject({ wins: 0, losses: 1 });

    const p1 = await prisma.leagueMatchupPlayerScore.findFirstOrThrow({
      where: { matchupId, playerId: 'int-nl-p1' },
    });
    expect(p1).toMatchObject({ clubResult: 'WIN', margin: 20, multiplier: 1 });
    expect(p1.aflMatchResultId).toBe(current.id);

    const audits = await rescoreAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0].actorMemberId).toBeNull();
    expect(audits[0].payloadJson).toMatchObject({
      round: ROUND,
      matchupId,
      trigger: 'result-correction',
      resultCorrections: [
        {
          supersededResultId: superseded.id,
          currentResultId: current.id,
          reason: superseded.supersedeReason,
        },
      ],
      before: { winnerMemberId: MEMBERS[1] },
      after: { winnerMemberId: MEMBERS[0] },
    });

    // Done once: the round's scores now use the current result.
    await expect(rescoreCorrectedResultRounds()).resolves.toEqual({
      rounds: [],
      pending: [],
      failedLeagueIds: [],
    });
    await expect(rescoreAudits()).resolves.toHaveLength(1);
  });

  it('an unchanged re-ingest triggers nothing', async () => {
    await expect(ingest(footywireRows([80, 100], [70, 73]))).resolves.toMatchObject({
      superseded: 0,
      unchanged: 2,
    });
    const before = await prisma.leagueMatchupScore.findMany({ where: { matchupId } });

    await expect(rescoreCorrectedResultRounds()).resolves.toEqual({
      rounds: [],
      pending: [],
      failedLeagueIds: [],
    });
    await expect(prisma.leagueMatchupScore.findMany({ where: { matchupId } })).resolves.toEqual(
      before
    );
    await expect(rescoreAudits()).resolves.toHaveLength(0);
  });

  it('a round the recalculation cannot re-score yet is pending, not "Re-scored", and stays pending (#1315)', async () => {
    await ingest(footywireRows([100, 80], [70, 73]));
    const superseded = await prisma.aflMatchResult.findFirstOrThrow({
      where: { season: AFL_SEASON, matchId: '95001', supersededById: { not: null } },
    });
    // What the recalculation answers when the round's stats are unavailable.
    const statsUnavailable = vi.fn().mockResolvedValue({
      round: ROUND,
      status: 'SCHEDULED',
      recalculated: 0,
      scores: [],
    });
    const info = vi.spyOn(logger, 'info');

    for (let run = 0; run < 2; run += 1) {
      await expect(rescoreCorrectedResultRounds(statsUnavailable)).resolves.toEqual({
        rounds: [],
        pending: [{ leagueId: LEAGUE, round: ROUND, correctedResultIds: [superseded.id] }],
        failedLeagueIds: [],
      });
    }
    expect(info).not.toHaveBeenCalledWith(
      'Re-scored a No Losers round after an AFL result correction',
      expect.anything()
    );
    info.mockRestore();
    await expect(rescoreAudits()).resolves.toHaveLength(0);
  });

  it('a correction that can no longer be joined never demotes the FINAL round (#1315)', async () => {
    // The corrected row names another round, so no stat row joins it.
    const previous = await prisma.aflMatchResult.findFirstOrThrow({
      where: { season: AFL_SEASON, matchId: '95001', supersededById: null },
    });
    await prisma.$transaction(async (tx) => {
      await tx.aflMatchResult.update({
        where: { id: previous.id },
        data: { supersededById: 'int-nl-relabelled', supersedeReason: 'round relabelled' },
      });
      await tx.aflMatchResult.create({
        data: {
          id: 'int-nl-relabelled',
          season: AFL_SEASON,
          round: 6,
          matchId: '95001',
          matchUid: '2091-R6-GWS-GEE',
          homeClub: previous.homeClub,
          awayClub: previous.awayClub,
          homePoints: 80,
          awayPoints: 100,
          margin: -20,
          status: 'FINAL',
          fetchedAt: new Date(),
          contentHash: 'relabelled',
        },
      });
    });
    const before = await prisma.leagueMatchup.findUniqueOrThrow({ where: { id: matchupId } });

    const run = await rescoreCorrectedResultRounds();

    expect(run).toEqual({ rounds: [], pending: [], failedLeagueIds: [LEAGUE] });
    await expect(
      recalculateLeagueRoundMatchups({ leagueId: LEAGUE, round: ROUND })
    ).resolves.toMatchObject({
      status: 'FINAL',
      blocked: 'FINAL_ROUND_RESULTS_UNJOINED',
      waitingOnResults: ['Waiting on the result of GWS v Geelong'],
    });
    await expect(
      prisma.leagueMatchup.findUniqueOrThrow({ where: { id: matchupId } })
    ).resolves.toEqual(before);
    await expect(
      prisma.leagueCompetitionRound.findFirstOrThrow({ where: { leagueId: LEAGUE } })
    ).resolves.toMatchObject({ status: 'FINAL' });
    await expect(rescoreAudits()).resolves.toHaveLength(0);
  });
});
