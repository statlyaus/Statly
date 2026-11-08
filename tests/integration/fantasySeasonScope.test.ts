/**
 * Season scope for fantasy state (owner decision 2026-11-08). Lineups, matchup scores, standings,
 * waiver priority and team actions carry a seasonId that references a real LeagueSeason, rows of
 * two seasons of one league read apart, and removing a season removes only its own rows.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { prisma } from '@/lib/prisma';
import { loadMemberLineup } from '@/server/leagues/lineupService';
import { loadLeagueStandingsHistory } from '@/server/leagues/standingsHistoryLoader';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';

const LEAGUE = 'int-season-scope-league';
const SETTINGS = 'int-season-scope-settings';
const OWNER = 'int-season-scope-owner';
const MEMBER = 'int-season-scope-member';
const SEASON_2026 = 'int-season-scope-2026';
const SEASON_2027 = 'int-season-scope-2027';

const removeFixture = () =>
  deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE],
    playerIds: ['int-season-scope-player'],
    settingsIds: [SETTINGS],
    userIds: [OWNER],
  });

async function seedLeagueWithTwoSeasons() {
  await removeFixture();
  await prisma.user.create({
    data: { id: OWNER, email: `${OWNER}@statly.local`, passwordHash: 'x', displayName: OWNER },
  });
  await prisma.leagueSettings.create({
    data: {
      id: SETTINGS,
      rosterSize: 1,
      benchSize: 0,
      maxTeams: 2,
      pickSeconds: 120,
      allowAutoPick: true,
      draftType: 'SNAKE',
      pickOrder: 'MANUAL',
      waiverRule: 'WEEKLY',
      timeZone: 'Australia/Melbourne',
      locked: false,
    },
  });
  await prisma.league.create({
    data: {
      id: LEAGUE,
      name: 'Season scope',
      inviteCode: 'INTSSCP',
      ownerId: OWNER,
      settingsId: SETTINGS,
    },
  });
  await prisma.leagueSeason.createMany({
    data: [
      { id: SEASON_2026, leagueId: LEAGUE, label: '2026 season', year: 2026 },
      { id: SEASON_2027, leagueId: LEAGUE, label: '2027 season', year: 2027 },
    ],
  });
  await prisma.league.update({ where: { id: LEAGUE }, data: { activeSeasonId: SEASON_2027 } });
  await prisma.leagueMember.create({
    data: { id: MEMBER, leagueId: LEAGUE, userId: OWNER, role: 'OWNER', teamName: 'Owner' },
  });
}

/** One lineup, matchup score and claim per season for the same member and round number. */
async function seedRoundOneInBothSeasons() {
  for (const seasonId of [SEASON_2026, SEASON_2027]) {
    const matchup = await prisma.leagueMatchup.create({
      data: {
        leagueId: LEAGUE,
        round: 1,
        fixtureVersion: seasonId === SEASON_2026 ? 1 : 2,
        homeMemberId: MEMBER,
      },
    });
    await prisma.leagueMatchupScore.create({
      data: {
        leagueId: LEAGUE,
        seasonId,
        matchupId: matchup.id,
        memberId: MEMBER,
        round: 1,
        categoriesJson: { goals: seasonId === SEASON_2026 ? 3 : 7 },
      },
    });
    await prisma.teamAction.create({
      data: {
        leagueId: LEAGUE,
        seasonId,
        memberId: MEMBER,
        actionType: 'WAIVER_CLAIM',
        details: { season: seasonId },
      },
    });
  }
  await prisma.leagueLineup.create({
    data: { leagueId: LEAGUE, seasonId: SEASON_2026, memberId: MEMBER, round: 1 },
  });
  await prisma.leagueStanding.create({
    data: { leagueId: LEAGUE, seasonId: SEASON_2026, memberId: MEMBER, wins: 4 },
  });
  await prisma.waiverPriority.create({
    data: { leagueId: LEAGUE, seasonId: SEASON_2026, memberId: MEMBER, priority: 1 },
  });
}

describe('fantasy season scope', () => {
  beforeEach(seedLeagueWithTwoSeasons);
  afterAll(async () => {
    await removeFixture();
    await prisma.$disconnect();
  });

  it('reads each season apart for the same league, member and round', async () => {
    await seedRoundOneInBothSeasons();

    const scores = await prisma.leagueMatchupScore.findMany({
      where: { leagueId: LEAGUE, seasonId: SEASON_2027, round: 1 },
    });
    expect(scores.map((score) => score.categoriesJson)).toEqual([{ goals: 7 }]);

    const claims = await prisma.teamAction.findMany({
      where: { leagueId: LEAGUE, seasonId: SEASON_2027, actionType: 'WAIVER_CLAIM' },
    });
    expect(claims.map((claim) => claim.details)).toEqual([{ season: SEASON_2027 }]);

    const where = { leagueId: LEAGUE, seasonId: SEASON_2027 };
    expect(await prisma.leagueLineup.count({ where })).toBe(0);
    expect(await prisma.leagueStanding.count({ where })).toBe(0);
    expect(await prisma.waiverPriority.count({ where })).toBe(0);
  });

  it('keeps one lineup per season for the same member and round, and loads the active one', async () => {
    const player = await prisma.player.upsert({
      where: { id: 'int-season-scope-player' },
      update: {},
      create: {
        id: 'int-season-scope-player',
        name: 'Season Scope',
        club: 'Club',
        position: 'MID',
      },
    });
    for (const [seasonId, slotIndex] of [
      [SEASON_2026, 0],
      [SEASON_2027, 1],
    ] as const) {
      await prisma.leagueLineup.create({
        data: {
          leagueId: LEAGUE,
          seasonId,
          memberId: MEMBER,
          round: 1,
          players: { create: { playerId: player.id, slot: 'MID', slotIndex } },
        },
      });
    }

    const active = await loadMemberLineup({ leagueId: LEAGUE, memberId: MEMBER, round: 1 });
    expect(active?.seasonId).toBe(SEASON_2027);
    expect(active?.players.map((row) => row.slotIndex)).toEqual([1]);

    await prisma.league.update({ where: { id: LEAGUE }, data: { activeSeasonId: SEASON_2026 } });
    const previous = await loadMemberLineup({ leagueId: LEAGUE, memberId: MEMBER, round: 1 });
    expect(previous?.seasonId).toBe(SEASON_2026);
    expect(previous?.players.map((row) => row.slotIndex)).toEqual([0]);
  });

  it('keeps one ladder row per season and shows the active season’s', async () => {
    await prisma.leagueStanding.createMany({
      data: [
        { leagueId: LEAGUE, seasonId: SEASON_2026, memberId: MEMBER, wins: 9, losses: 2 },
        { leagueId: LEAGUE, seasonId: SEASON_2027, memberId: MEMBER, wins: 1, losses: 3 },
      ],
    });

    const history = await loadLeagueStandingsHistory(LEAGUE);
    expect(history?.teams.map((team) => [team.memberId, team.wins, team.losses])).toEqual([
      [MEMBER, 1, 3],
    ]);
  });

  it('refuses a season that does not exist', async () => {
    await expect(
      prisma.leagueStanding.create({
        data: { leagueId: LEAGUE, seasonId: 'no-such-season', memberId: MEMBER },
      })
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.waiverPriority.create({
        data: { leagueId: LEAGUE, seasonId: 'no-such-season', memberId: MEMBER, priority: 1 },
      })
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('removes only the deleted season’s rows', async () => {
    await seedRoundOneInBothSeasons();

    await prisma.leagueSeason.delete({ where: { id: SEASON_2026 } });

    const league = { leagueId: LEAGUE };
    expect(await prisma.leagueLineup.count({ where: league })).toBe(0);
    expect(await prisma.leagueStanding.count({ where: league })).toBe(0);
    expect(await prisma.waiverPriority.count({ where: league })).toBe(0);
    const remaining = await Promise.all([
      prisma.leagueMatchupScore.findMany({ where: league, select: { seasonId: true } }),
      prisma.teamAction.findMany({ where: league, select: { seasonId: true } }),
    ]);
    expect(remaining.flat()).toEqual([{ seasonId: SEASON_2027 }, { seasonId: SEASON_2027 }]);
  });
});
