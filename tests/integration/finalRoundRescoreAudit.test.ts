/**
 * A FINAL round may be rescored (stat corrections), but every change to a FINAL matchup's stored
 * result is recorded in LeagueCompetitionAudit with before and after, in the scoring transaction
 * (process-map finding roster-scoring-11, owner decision 2026-11-11). Runs against PostgreSQL so
 * jsonb's key reordering of stored category rows is exercised.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const provider = vi.hoisted(() => ({ goals: [0, 0], status: 'final' }));
vi.mock('@/server/etl/etlRoundData', () => ({
  getRoundMatches: vi.fn().mockResolvedValue([]),
  getRoundMatchesResult: vi.fn(() =>
    Promise.resolve({
      ok: true,
      matches: [
        { match_uid: 'afl-1', status: provider.status, home_team: 'GWS', away_team: 'Geelong' },
      ],
    })
  ),
  getRoundPlayerStatsResult: vi.fn(() =>
    Promise.resolve({
      ok: true,
      stats: PLAYERS.map((playerId, index) => ({
        player_uid: playerId,
        round_number: 5,
        status: provider.status,
        stats: { minutes: 80, goals: provider.goals[index] },
      })),
    })
  ),
}));

import { prisma } from '@/lib/prisma';
import { recalculateLeagueRoundMatchups } from '@/server/leagues/matchupReadModel';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';

const LEAGUE = 'int-final-rescore-league';
const SETTINGS = 'int-final-rescore-settings';
const OWNER = 'int-final-rescore-owner';
const RIVAL = 'int-final-rescore-rival';
const SEASON = 'int-final-rescore-2026';
const MEMBERS = ['int-final-rescore-m1', 'int-final-rescore-m2'];
const PLAYERS = ['int-final-rescore-p1', 'int-final-rescore-p2'];
const ROUND = 1;

const removeFixture = () =>
  deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE],
    playerIds: PLAYERS,
    settingsIds: [SETTINGS],
    userIds: [OWNER, RIVAL],
  });

async function seedLeague() {
  await removeFixture();
  for (const id of [OWNER, RIVAL]) {
    await prisma.user.create({
      data: { id, email: `${id}@statly.local`, passwordHash: 'x', displayName: id },
    });
  }
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
      competitionRulesVersion: 1,
      competitionStatus: 'ACTIVE',
    },
  });
  await prisma.league.create({
    data: {
      id: LEAGUE,
      name: 'Final rescore',
      inviteCode: 'INTFRSC',
      ownerId: OWNER,
      settingsId: SETTINGS,
      categoriesJson: ['goals'],
    },
  });
  await prisma.leagueSeason.create({
    data: { id: SEASON, leagueId: LEAGUE, label: '2026 season', year: 2026 },
  });
  await prisma.league.update({ where: { id: LEAGUE }, data: { activeSeasonId: SEASON } });
  for (const [index, id] of MEMBERS.entries()) {
    await prisma.leagueMember.create({
      data: {
        id,
        leagueId: LEAGUE,
        userId: [OWNER, RIVAL][index],
        role: index === 0 ? 'OWNER' : 'MANAGER',
        teamName: id,
      },
    });
    await prisma.player.create({
      data: { id: PLAYERS[index], name: PLAYERS[index], club: 'GWS', position: 'MID' },
    });
    await prisma.leagueLineup.create({
      data: {
        leagueId: LEAGUE,
        seasonId: SEASON,
        memberId: id,
        round: ROUND,
        players: { create: { playerId: PLAYERS[index], slot: 'MID', slotIndex: 0 } },
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
      publishedAt: new Date('2026-02-01T00:00:00.000Z'),
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

const audits = () =>
  prisma.leagueCompetitionAudit.findMany({
    where: { leagueId: LEAGUE, eventType: 'FINAL_ROUND_RESCORED' },
  });

describe('rescoring a FINAL round', () => {
  let matchupId: string;

  beforeEach(async () => {
    matchupId = await seedLeague();
    provider.status = 'final';
    provider.goals = [2, 1];
    // First scoring finalizes the round: no audit, nothing was FINAL before.
    await expect(
      recalculateLeagueRoundMatchups({ leagueId: LEAGUE, round: ROUND })
    ).resolves.toMatchObject({ status: 'FINAL', recalculated: 1 });
  });

  afterAll(removeFixture);

  it('writes nothing when the recalculation reproduces the stored result', async () => {
    await recalculateLeagueRoundMatchups({ leagueId: LEAGUE, round: ROUND });

    await expect(audits()).resolves.toEqual([]);
  });

  it('records the changed matchup with before and after, and recomputes the ladder', async () => {
    provider.goals = [2, 3];

    await recalculateLeagueRoundMatchups({
      leagueId: LEAGUE,
      round: ROUND,
      actorMemberId: MEMBERS[0],
    });

    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorMemberId: MEMBERS[0],
      payloadJson: {
        seasonId: SEASON,
        round: ROUND,
        matchupId,
        trigger: 'manual',
        before: { status: 'FINAL', winnerMemberId: MEMBERS[0], homeCategoryWins: 1 },
        after: { status: 'FINAL', winnerMemberId: MEMBERS[1], awayCategoryWins: 1 },
      },
    });
    const standings = await prisma.leagueStanding.findMany({
      where: { leagueId: LEAGUE, seasonId: SEASON },
      select: { memberId: true, wins: true, losses: true },
      orderBy: { memberId: 'asc' },
    });
    expect(standings).toEqual([
      { memberId: MEMBERS[0], wins: 0, losses: 1 },
      { memberId: MEMBERS[1], wins: 1, losses: 0 },
    ]);
  });

  it('refuses a commissioner finalize while an AFL match is not final', async () => {
    provider.status = 'live';

    await expect(
      recalculateLeagueRoundMatchups({
        leagueId: LEAGUE,
        round: ROUND,
        finalize: true,
        actorMemberId: MEMBERS[0],
      })
    ).resolves.toMatchObject({ blocked: 'AFL_MATCHES_NOT_FINAL' });
    await expect(audits()).resolves.toEqual([]);
  });
});
