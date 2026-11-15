/**
 * A published season's status follows its rounds (process-map finding league-05, owner decision
 * 2026-11-15): ACTIVE once its first round is scored, COMPLETE once every round, finals included,
 * is FINAL.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const provider = vi.hoisted(() => ({ goals: [0, 0], status: 'final', aflRound: 5 }));
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
        round_number: provider.aflRound,
        status: provider.status,
        stats: { minutes: 80, goals: provider.goals[index] },
      })),
    })
  ),
}));

import { prisma } from '@/lib/prisma';
import { recalculateLeagueRoundMatchups } from '@/server/leagues/matchupReadModel';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';

const LEAGUE = 'int-season-status-league';
const SETTINGS = 'int-season-status-settings';
const OWNER = 'int-season-status-owner';
const RIVAL = 'int-season-status-rival';
const SEASON = 'int-season-status-2026';
const MEMBERS = ['int-season-status-m1', 'int-season-status-m2'];
const PLAYERS = ['int-season-status-p1', 'int-season-status-p2'];
const ROUNDS = [1, 2];

const removeFixture = () =>
  deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE],
    playerIds: PLAYERS,
    settingsIds: [SETTINGS],
    userIds: [OWNER, RIVAL],
  });

async function seedLeague(): Promise<void> {
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
      competitionStatus: 'PENDING',
    },
  });
  await prisma.league.create({
    data: {
      id: LEAGUE,
      name: 'Season status',
      inviteCode: 'INTSSTS',
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
    for (const round of ROUNDS) {
      await prisma.leagueLineup.create({
        data: {
          leagueId: LEAGUE,
          seasonId: SEASON,
          memberId: id,
          round,
          players: { create: { playerId: PLAYERS[index], slot: 'MID', slotIndex: 0 } },
        },
      });
    }
  }
  for (const round of ROUNDS) {
    const competitionRound = await prisma.leagueCompetitionRound.create({
      data: {
        leagueId: LEAGUE,
        seasonId: SEASON,
        fixtureVersion: 1,
        round,
        aflRound: round + 4,
        status: 'SCHEDULED',
        publishedAt: new Date('2026-02-01T00:00:00.000Z'),
      },
    });
    await prisma.leagueMatchup.create({
      data: {
        leagueId: LEAGUE,
        round,
        fixtureVersion: 1,
        competitionRoundId: competitionRound.id,
        homeMemberId: MEMBERS[0],
        awayMemberId: MEMBERS[1],
      },
    });
  }
}

const seasonStatus = async () =>
  (await prisma.leagueSettings.findUniqueOrThrow({ where: { id: SETTINGS } })).competitionStatus;

async function score(round: number, status: 'live' | 'final') {
  provider.status = status;
  provider.aflRound = round + 4;
  provider.goals = [2, 1];
  return recalculateLeagueRoundMatchups({ leagueId: LEAGUE, round });
}

describe('the season status follows its rounds', () => {
  beforeEach(seedLeague);

  afterAll(removeFixture);

  it('becomes ACTIVE once the first round is scored live', async () => {
    await expect(score(1, 'live')).resolves.toMatchObject({ status: 'LIVE' });

    await expect(seasonStatus()).resolves.toBe('ACTIVE');
  });

  it('stays ACTIVE while a later round is still to be played', async () => {
    await expect(score(1, 'final')).resolves.toMatchObject({ status: 'FINAL' });

    await expect(seasonStatus()).resolves.toBe('ACTIVE');
  });

  it('becomes COMPLETE once every round is FINAL', async () => {
    await score(1, 'final');
    await expect(score(2, 'final')).resolves.toMatchObject({ status: 'FINAL' });

    await expect(seasonStatus()).resolves.toBe('COMPLETE');
  });
});
