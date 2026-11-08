/**
 * A player with a pending waiver claim, or dropped since the last 6 am Melbourne waiver run, can only
 * be won at a waiver run. Free-agent Add refuses him. Run against PostgreSQL because the rule lives
 * in JSON-path and time filters.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { prisma } from '@/lib/prisma';
import { addFreeAgentToRoster } from '@/server/rosters/freeAgentAdd';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';

const LEAGUE = 'int-waiver-only-league';
const SETTINGS = 'int-waiver-only-settings';
const DRAFT = 'int-waiver-only-draft';
const USER = 'int-waiver-only-user';
const RIVAL = 'int-waiver-only-rival';
const MEMBER = 'int-waiver-only-member';
const RIVAL_MEMBER = 'int-waiver-only-rival-member';
const PLAYER = 'int-waiver-only-player';

// 10 am Wednesday 1 July 2026 in Melbourne (AEST); the last waiver run was 6 am that morning.
const NOW = new Date('2026-07-01T00:00:00.000Z');
const LAST_RUN = new Date('2026-06-30T20:00:00.000Z');
const HOUR = 60 * 60 * 1000;

const removeFixture = () =>
  deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE],
    playerIds: [PLAYER],
    settingsIds: [SETTINGS],
    userIds: [USER, RIVAL],
  });

function add() {
  return addFreeAgentToRoster(prisma, {
    leagueId: LEAGUE,
    userId: USER,
    playerId: PLAYER,
    playerAliasIds: [PLAYER],
    now: NOW,
  });
}

async function action(data: {
  actionType: 'WAIVER_CLAIM' | 'DROP_PLAYER';
  status?: 'PENDING' | 'CANCELLED' | 'PROCESSED';
  createdAt: Date;
  processingAt: Date;
}) {
  await prisma.teamAction.create({
    data: {
      leagueId: LEAGUE,
      memberId: RIVAL_MEMBER,
      actionType: data.actionType,
      status: data.status ?? 'PENDING',
      details: { playerId: PLAYER },
      createdAt: data.createdAt,
      processingAt: data.processingAt,
    },
  });
}

describe.sequential('free-agent add refuses waiver-only players', () => {
  beforeAll(async () => {
    await removeFixture();
    await prisma.user.createMany({
      data: [USER, RIVAL].map((id) => ({
        id,
        email: `${id}@statly.local`,
        passwordHash: 'x',
        displayName: id,
      })),
    });
    await prisma.player.create({
      data: { id: PLAYER, name: 'Waiver Only', club: 'Test', position: 'MID' },
    });
    await prisma.leagueSettings.create({
      data: {
        id: SETTINGS,
        rosterSize: 4,
        benchSize: 2,
        maxTeams: 2,
        pickSeconds: 60,
        draftType: 'SNAKE',
        startAt: NOW,
      },
    });
    await prisma.league.create({
      data: {
        id: LEAGUE,
        name: 'Waiver only',
        inviteCode: 'WAIVERONLY',
        ownerId: USER,
        settingsId: SETTINGS,
      },
    });
    await prisma.leagueMember.createMany({
      data: [
        { id: MEMBER, leagueId: LEAGUE, userId: USER, teamName: 'Mine', role: 'OWNER' },
        { id: RIVAL_MEMBER, leagueId: LEAGUE, userId: RIVAL, teamName: 'Rival', role: 'MANAGER' },
      ],
    });
    await prisma.draft.create({
      data: { id: DRAFT, leagueId: LEAGUE, status: 'COMPLETED', totalPicks: 12 },
    });
  });

  beforeEach(async () => {
    await prisma.teamAction.deleteMany({ where: { leagueId: LEAGUE } });
    await prisma.leagueRosterPlayer.deleteMany({ where: { leagueId: LEAGUE } });
  });

  afterAll(async () => {
    await removeFixture();
  });

  it('refuses a player with a pending claim that is already due but not yet run', async () => {
    await action({
      actionType: 'WAIVER_CLAIM',
      createdAt: new Date(NOW.getTime() - 30 * HOUR),
      processingAt: new Date(NOW.getTime() - 6 * HOUR),
    });

    await expect(add()).rejects.toMatchObject({ code: 'PLAYER_ON_WAIVERS', status: 409 });
    await expect(prisma.leagueRosterPlayer.count({ where: { leagueId: LEAGUE } })).resolves.toBe(0);
  });

  it('refuses a player dropped since the last waiver run even with no waiver period left', async () => {
    await action({
      actionType: 'DROP_PLAYER',
      createdAt: new Date(LAST_RUN.getTime() + HOUR),
      processingAt: new Date(LAST_RUN.getTime() + HOUR),
    });

    await expect(add()).rejects.toMatchObject({ code: 'PLAYER_ON_WAIVERS', status: 409 });
  });

  it('adds a player dropped before the last waiver run once his hold has passed', async () => {
    await action({
      actionType: 'DROP_PLAYER',
      createdAt: new Date(LAST_RUN.getTime() - 25 * HOUR),
      processingAt: new Date(LAST_RUN.getTime() - HOUR),
    });

    await expect(add()).resolves.toMatchObject({ memberId: MEMBER });
  });

  it('adds a player whose only claim was cancelled', async () => {
    await action({
      actionType: 'WAIVER_CLAIM',
      status: 'CANCELLED',
      createdAt: new Date(NOW.getTime() - HOUR),
      processingAt: new Date(NOW.getTime() + 23 * HOUR),
    });

    await expect(add()).resolves.toMatchObject({ memberId: MEMBER });
  });
});
