/**
 * No Losers scoring on PostgreSQL (#1294, epic #1290 BR-07, BR-08, BR-21): a counted player's stats
 * are multiplied by his club's stored result, joined by matchUid and club abbreviation; the round
 * cannot be FINAL while a result is missing; the stored per-player rows re-derive the team totals.
 * Standard and Bloodsucker leagues score exactly as before (golden).
 */
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

import { prisma } from '@/lib/prisma';
import { recalculateLeagueRoundMatchups } from '@/server/leagues/matchupReadModel';
import { aggregateLineupCategoryTotals } from '@/server/leagues/matchupScoringEngine';
import type { FantasyCategoryKey } from '@/types/fantasyCategories';

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

afterAll(removeFixture);

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
