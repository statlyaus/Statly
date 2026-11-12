/**
 * Bloodsucker 3/9 (#1280): the exclusive free-agency window after the draft and the auto-fill at its
 * close. Run against PostgreSQL because the close is one transaction under the League row lock and
 * its idempotency rests on a stored audit row.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const HIGH = 1000;
const stats = vi.hoisted(() => ({ goalsByPlayerId: new Map<string, number>() }));
vi.mock('@/server/draft/readModels/draftPlayerReadModel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/draft/readModels/draftPlayerReadModel')>()),
  loadDraftPlayerStatsLookup: async () => ({
    byId: new Map([...stats.goalsByPlayerId].map(([id, goals]) => [id, { stats: { goals } }])),
    byNameAndTeam: new Map(),
    byName: new Map(),
  }),
}));
// The Firestore ownership projection and the stats file are not part of this rule.
vi.mock('@/server/waivers/WaiverAvailabilityProjectionService', () => ({
  WaiverAvailabilityProjectionService: class {
    projectLeague = vi.fn().mockResolvedValue({ owned: 0, available: 0 });
  },
}));
vi.mock('@/lib/data', () => ({ getPlayers: async () => [] }));

import { prisma } from '@/lib/prisma';
import {
  closeBloodsuckerWindow,
  sweepBloodsuckerWindows,
} from '@/server/leagues/bloodsuckerAutoFill';
import { getTransactionWindow } from '@/server/leagues/transactionWindow';
import { addFreeAgentToRoster } from '@/server/rosters/freeAgentAdd';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';
import { activateLeagueSeason } from './helpers/leagueSeason';

const LEAGUE = 'int-bs-window-league';
const SETTINGS = 'int-bs-window-settings';
const DRAFT = 'int-bs-window-draft';
const BLOODSUCKER_USER = 'int-bs-window-sucker';
const RIVAL_USER = 'int-bs-window-rival';
const BLOODSUCKER = 'int-bs-window-sucker-member';
const RIVAL = 'int-bs-window-rival-member';
// Ids sort a < b < c < d < e. `a` and `b` tie on the top score, so the lower id wins the tie.
const PLAYERS = ['a', 'b', 'c', 'd', 'e'].map((key) => `int-bs-window-player-${key}`);
const [PLAYER_A, PLAYER_B, PLAYER_C, PLAYER_D, PLAYER_E] = PLAYERS as [
  string,
  string,
  string,
  string,
  string,
];

const HOUR = 60 * 60 * 1000;
const DRAFTED_AT = new Date('2026-03-01T02:00:00.000Z');
const DURING = new Date(DRAFTED_AT.getTime() + 2 * HOUR);
const AFTER = new Date(DRAFTED_AT.getTime() + 24 * HOUR);
let seasonId = '';

const removeFixture = () =>
  deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE],
    playerIds: PLAYERS,
    settingsIds: [SETTINGS],
    userIds: [BLOODSUCKER_USER, RIVAL_USER],
  });

function add(userId: string, playerId: string, now = DURING) {
  return addFreeAgentToRoster(prisma, {
    leagueId: LEAGUE,
    userId,
    playerId,
    playerAliasIds: [playerId],
    now,
  });
}

const bloodsuckerRoster = async () =>
  (
    await prisma.leagueRosterPlayer.findMany({
      where: { leagueId: LEAGUE, memberId: BLOODSUCKER },
      select: { playerId: true, acquiredBy: true },
      orderBy: { playerId: 'asc' },
    })
  ).map((row) => `${row.playerId}:${row.acquiredBy}`);

const closeAudits = () =>
  prisma.leagueCompetitionAudit.findMany({
    where: { leagueId: LEAGUE, eventType: 'BLOODSUCKER_WINDOW_CLOSED' },
  });

describe.sequential('Bloodsucker exclusive window and auto-fill', () => {
  beforeAll(async () => {
    await removeFixture();
    // Far above any player another fixture leaves behind, so the ranking below is this file's alone.
    stats.goalsByPlayerId = new Map([
      [PLAYER_A, HIGH],
      [PLAYER_B, HIGH],
      [PLAYER_C, HIGH + 5],
      [PLAYER_D, HIGH - 1],
      [PLAYER_E, HIGH - 2],
    ]);
    await prisma.user.createMany({
      data: [BLOODSUCKER_USER, RIVAL_USER].map((id) => ({
        id,
        email: `${id}@statly.local`,
        passwordHash: 'x',
        displayName: id,
      })),
    });
    await prisma.player.createMany({
      data: PLAYERS.map((id) => ({ id, name: id, club: 'Test', position: 'MID' })),
    });
    await prisma.leagueSettings.create({
      data: {
        id: SETTINGS,
        rosterSize: 2,
        benchSize: 1,
        maxTeams: 2,
        pickSeconds: 60,
        draftType: 'SNAKE',
        startAt: DRAFTED_AT,
        leagueFormat: 'BLOODSUCKER',
      },
    });
    await prisma.league.create({
      data: {
        id: LEAGUE,
        name: 'Bloodsucker window',
        inviteCode: 'BSWINDOW',
        ownerId: RIVAL_USER,
        settingsId: SETTINGS,
        categoriesJson: ['goals'],
      },
    });
    seasonId = await activateLeagueSeason(prisma, LEAGUE);
    await prisma.leagueMember.createMany({
      data: [
        {
          id: BLOODSUCKER,
          leagueId: LEAGUE,
          userId: BLOODSUCKER_USER,
          teamName: 'Sucker',
          role: 'MANAGER',
        },
        { id: RIVAL, leagueId: LEAGUE, userId: RIVAL_USER, teamName: 'Rival', role: 'OWNER' },
      ],
    });
    await prisma.leagueSettings.update({
      where: { id: SETTINGS },
      data: { bloodsuckerMemberId: BLOODSUCKER },
    });
    await prisma.draft.create({
      data: {
        id: DRAFT,
        leagueId: LEAGUE,
        status: 'COMPLETED',
        totalPicks: 3,
        completedAt: DRAFTED_AT,
      },
    });
  });

  beforeEach(async () => {
    await prisma.socialMessage.deleteMany({ where: { leagueId: LEAGUE } });
    await prisma.socialCommand.deleteMany({ where: { leagueId: LEAGUE } });
    await prisma.leagueCompetitionAudit.deleteMany({ where: { leagueId: LEAGUE } });
    await prisma.leagueLineup.deleteMany({ where: { leagueId: LEAGUE } });
    await prisma.teamAction.deleteMany({ where: { leagueId: LEAGUE } });
    await prisma.leagueRosterPlayer.deleteMany({ where: { leagueId: LEAGUE } });
  });

  afterAll(async () => {
    await removeFixture();
  });

  it('refuses another member during the window and lets him in when it closes', async () => {
    await expect(add(RIVAL_USER, PLAYER_A)).rejects.toMatchObject({
      code: 'BLOODSUCKER_WINDOW_OPEN',
      status: 409,
      message: expect.stringContaining('The Bloodsucker has first pick of free agents until'),
    });
    await expect(prisma.leagueRosterPlayer.count({ where: { leagueId: LEAGUE } })).resolves.toBe(0);
    await expect(
      getTransactionWindow(LEAGUE, prisma, { memberId: RIVAL, now: DURING })
    ).resolves.toMatchObject({ code: 'BLOODSUCKER_WINDOW_OPEN', closesAt: AFTER.toISOString() });

    await expect(add(RIVAL_USER, PLAYER_A, AFTER)).resolves.toMatchObject({ memberId: RIVAL });
  });

  it('lets the Bloodsucker add a player in a waiver hold during the window, and nobody after it', async () => {
    await prisma.teamAction.create({
      data: {
        leagueId: LEAGUE,
        seasonId,
        memberId: RIVAL,
        actionType: 'DROP_PLAYER',
        details: { playerId: PLAYER_A },
        createdAt: DURING,
        processingAt: new Date(AFTER.getTime() + 24 * HOUR),
      },
    });

    await expect(add(BLOODSUCKER_USER, PLAYER_A)).resolves.toMatchObject({ memberId: BLOODSUCKER });

    await prisma.leagueRosterPlayer.deleteMany({ where: { leagueId: LEAGUE } });
    await expect(add(BLOODSUCKER_USER, PLAYER_A, AFTER)).rejects.toMatchObject({
      code: 'PLAYER_ON_WAIVERS',
    });
  });

  it('does not close a window that is still open', async () => {
    await expect(closeBloodsuckerWindow(LEAGUE, DURING)).resolves.toEqual({
      closed: false,
      reason: 'WINDOW_OPEN',
    });
    await expect(closeAudits()).resolves.toHaveLength(0);
  });

  it('fills the empty spots by Statly Z with ties to the lower id, and a second close adds nothing', async () => {
    // Capacity is 3. The Bloodsucker took one player itself and a rival owns the best one left.
    await add(BLOODSUCKER_USER, PLAYER_E);
    await prisma.leagueRosterPlayer.create({
      data: { leagueId: LEAGUE, memberId: RIVAL, playerId: PLAYER_C, acquiredBy: 'DRAFT' },
    });

    await expect(closeBloodsuckerWindow(LEAGUE, AFTER)).resolves.toEqual({
      closed: true,
      filledPlayerIds: [PLAYER_A, PLAYER_B],
    });
    const filled = [
      `${PLAYER_A}:BLOODSUCKER_AUTO_FILL`,
      `${PLAYER_B}:BLOODSUCKER_AUTO_FILL`,
      `${PLAYER_E}:FREE_AGENT`,
    ];
    await expect(bloodsuckerRoster()).resolves.toEqual(filled);

    const [audit, ...extraAudits] = await closeAudits();
    expect(extraAudits).toEqual([]);
    expect(audit?.payloadJson).toMatchObject({
      ruleVersion: 1,
      draftId: DRAFT,
      bloodsuckerMemberId: BLOODSUCKER,
      windowClosedAt: AFTER.toISOString(),
      windowSkipped: false,
      emptySpots: 2,
      filledPlayerIds: [PLAYER_A, PLAYER_B],
    });
    // BR-14: the Bloodsucker has a round 1 lineup without saving one.
    await expect(
      prisma.leagueLineup.count({ where: { leagueId: LEAGUE, memberId: BLOODSUCKER, round: 1 } })
    ).resolves.toBe(1);
    const messages = await prisma.socialMessage.findMany({ where: { leagueId: LEAGUE } });
    expect(messages.map((message) => message.content)).toEqual([
      "The Bloodsucker's free-agency window has closed. 2 empty roster spots were filled with the best available players. Adds, drops, waiver claims and trades are open to everyone.",
    ]);

    // A drop after the close must not be refilled by a later sweep.
    await prisma.leagueRosterPlayer.deleteMany({ where: { leagueId: LEAGUE, playerId: PLAYER_A } });
    await expect(closeBloodsuckerWindow(LEAGUE, AFTER)).resolves.toEqual({
      closed: false,
      reason: 'ALREADY_CLOSED',
    });
    const sweep = await sweepBloodsuckerWindows(AFTER);
    expect(sweep.checkedLeagueIds).toContain(LEAGUE);
    expect(sweep.closedLeagueIds).not.toContain(LEAGUE);
    expect(sweep.failedLeagueIds).toEqual([]);
    await expect(bloodsuckerRoster()).resolves.toEqual(filled.slice(1));
    await expect(closeAudits()).resolves.toHaveLength(1);
    await expect(prisma.socialMessage.count({ where: { leagueId: LEAGUE } })).resolves.toBe(1);
  });

  it('closes at once from the sweep when the draft finished too close to round 1 for a window (E6)', async () => {
    await prisma.leagueSettings.update({
      where: { id: SETTINGS },
      data: { competitionRulesVersion: 1 },
    });
    await prisma.leagueCompetitionRound.create({
      data: {
        leagueId: LEAGUE,
        seasonId,
        fixtureVersion: 1,
        round: 1,
        startsAt: new Date(DRAFTED_AT.getTime() + 2 * HOUR),
      },
    });
    try {
      const justAfterDraft = new Date(DRAFTED_AT.getTime() + 60 * 1000);
      await expect(add(RIVAL_USER, PLAYER_C, justAfterDraft)).resolves.toMatchObject({
        memberId: RIVAL,
      });

      const sweep = await sweepBloodsuckerWindows(justAfterDraft);
      expect(sweep.closedLeagueIds).toContain(LEAGUE);
      await expect(bloodsuckerRoster()).resolves.toEqual(
        [PLAYER_A, PLAYER_B, PLAYER_D].map((id) => `${id}:BLOODSUCKER_AUTO_FILL`)
      );
      const [audit] = await closeAudits();
      expect(audit?.payloadJson).toMatchObject({ windowSkipped: true, emptySpots: 3 });
    } finally {
      await prisma.leagueCompetitionRound.deleteMany({ where: { leagueId: LEAGUE } });
      await prisma.leagueSettings.update({
        where: { id: SETTINGS },
        data: { competitionRulesVersion: 0 },
      });
    }
  });
});
