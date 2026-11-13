/**
 * Bloodsucker 9/9 (#1286): what the screens read. Every member sees the Bloodsucker, its record and
 * this season's bites (BR-40); only the Bloodsucker reads its bite picker, which groups players by
 * slot after autosubs, previews the auto-bite (BR-28) and names any refusal before a click (NFR-5).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const stats = vi.hoisted(() => ({ goalsByPlayerId: new Map<string, number>() }));
vi.mock('@/server/draft/readModels/draftPlayerReadModel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/draft/readModels/draftPlayerReadModel')>()),
  loadDraftPlayerStatsLookup: async () => ({
    byId: new Map([...stats.goalsByPlayerId].map(([id, goals]) => [id, { stats: { goals } }])),
    byNameAndTeam: new Map(),
    byName: new Map(),
  }),
}));

import { prisma } from '@/lib/prisma';
import {
  BloodsuckerReadError,
  loadBitePicker,
  loadBloodsuckerSummary,
} from '@/server/leagues/bloodsuckerReadModel';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';

const P = 'int-bs-read';
const LEAGUE = `${P}-league`;
const SETTINGS = `${P}-settings`;
const SEASON = `${P}-2026`;
const USERS = { owner: `${P}-u-owner`, bs: `${P}-u-bs`, victim: `${P}-u-victim` };
const OWNER = `${P}-owner`;
const BS = `${P}-bs`;
const VICTIM = `${P}-victim`;
const PLAYERS = ['v1', 'v2', 'v3', 'b1', 'b2'].map((key) => `${P}-${key}`);
const [V1, V2, V3, B1, B2] = PLAYERS as [string, string, string, string, string];
const HOUR = 60 * 60 * 1000;
const NOW = new Date();

const removeFixture = () =>
  deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE],
    playerIds: PLAYERS,
    settingsIds: [SETTINGS],
    userIds: Object.values(USERS),
  });

let biteId = '';

async function seed(options: { roundTwoStartsAt?: Date } = {}) {
  await removeFixture();
  stats.goalsByPlayerId = new Map([
    [V1, 3],
    [V2, 9],
    [V3, 1],
    [B1, 5],
    [B2, 0.5],
  ]);
  await prisma.user.createMany({
    data: Object.values(USERS).map((id) => ({
      id,
      email: `${id}@statly.local`,
      passwordHash: 'x',
      displayName: id,
    })),
  });
  await prisma.player.createMany({
    data: PLAYERS.map((id, index) => ({
      id,
      name: `Player ${index + 1}`,
      club: 'GWS',
      position: 'MID',
    })),
  });
  await prisma.leagueSettings.create({
    data: {
      id: SETTINGS,
      rosterSize: 3,
      benchSize: 0,
      maxTeams: 3,
      pickSeconds: 60,
      draftType: 'SNAKE',
      waiverRule: 'ROLLING',
      competitionRulesVersion: 1,
      competitionStatus: 'ACTIVE',
      leagueFormat: 'BLOODSUCKER',
    },
  });
  await prisma.league.create({
    data: {
      id: LEAGUE,
      name: 'Read',
      inviteCode: 'INTBSRED',
      ownerId: USERS.owner,
      settingsId: SETTINGS,
      categoriesJson: ['goals'],
    },
  });
  await prisma.leagueSeason.create({
    data: { id: SEASON, leagueId: LEAGUE, label: '2026 season', year: 2026 },
  });
  await prisma.league.update({ where: { id: LEAGUE }, data: { activeSeasonId: SEASON } });
  await prisma.leagueMember.createMany({
    data: [
      { id: OWNER, leagueId: LEAGUE, userId: USERS.owner, role: 'OWNER', teamName: 'Owners' },
      { id: BS, leagueId: LEAGUE, userId: USERS.bs, role: 'MANAGER', teamName: 'Suckers' },
      { id: VICTIM, leagueId: LEAGUE, userId: USERS.victim, role: 'MANAGER', teamName: 'Victims' },
    ],
  });
  await prisma.leagueSettings.update({
    where: { id: SETTINGS },
    data: { bloodsuckerMemberId: BS },
  });
  await prisma.leagueRosterPlayer.createMany({
    data: [
      { leagueId: LEAGUE, memberId: VICTIM, playerId: V1 },
      { leagueId: LEAGUE, memberId: VICTIM, playerId: V2 },
      { leagueId: LEAGUE, memberId: VICTIM, playerId: V3 },
      { leagueId: LEAGUE, memberId: BS, playerId: B1 },
      { leagueId: LEAGUE, memberId: BS, playerId: B2 },
    ],
  });
  const round1 = await prisma.leagueCompetitionRound.create({
    data: {
      leagueId: LEAGUE,
      seasonId: SEASON,
      fixtureVersion: 1,
      round: 1,
      status: 'FINAL',
      startsAt: new Date(NOW.getTime() - 72 * HOUR),
      endsAt: new Date(NOW.getTime() - 24 * HOUR),
    },
  });
  await prisma.leagueCompetitionRound.create({
    data: {
      leagueId: LEAGUE,
      seasonId: SEASON,
      fixtureVersion: 1,
      round: 2,
      startsAt: options.roundTwoStartsAt ?? new Date(NOW.getTime() + 72 * HOUR),
      endsAt: new Date(NOW.getTime() + 120 * HOUR),
    },
  });
  const won = await prisma.leagueMatchup.create({
    data: {
      leagueId: LEAGUE,
      round: 1,
      fixtureVersion: 1,
      competitionRoundId: round1.id,
      homeMemberId: VICTIM,
      awayMemberId: BS,
      status: 'FINAL',
      winnerMemberId: BS,
      homeCategoryWins: 4,
      awayCategoryWins: 5,
    },
  });
  // Two more results for the record: a loss and a draw, plus an unrelated matchup.
  await prisma.leagueMatchup.createMany({
    data: [
      {
        leagueId: LEAGUE,
        round: 1,
        fixtureVersion: 0,
        homeMemberId: BS,
        awayMemberId: OWNER,
        status: 'FINAL',
        winnerMemberId: BS,
      },
      {
        leagueId: LEAGUE,
        round: 2,
        fixtureVersion: 1,
        homeMemberId: BS,
        awayMemberId: OWNER,
        status: 'FINAL',
        winnerMemberId: OWNER,
      },
      {
        leagueId: LEAGUE,
        round: 3,
        fixtureVersion: 1,
        homeMemberId: OWNER,
        awayMemberId: BS,
        status: 'FINAL',
        winnerMemberId: null,
      },
      {
        leagueId: LEAGUE,
        round: 4,
        fixtureVersion: 1,
        homeMemberId: OWNER,
        awayMemberId: BS,
        status: 'SCHEDULED',
      },
    ],
  });
  // The victim's round 1 lineup: V1 at RUC, V2 on the interchange. V2 came on for V1 (autosub).
  await prisma.leagueLineup.create({
    data: {
      leagueId: LEAGUE,
      seasonId: SEASON,
      memberId: VICTIM,
      round: 1,
      players: {
        create: [
          { playerId: V1, slot: 'RUC', slotIndex: 0 },
          { playerId: V2, slot: 'INTERCHANGE', slotIndex: 0 },
        ],
      },
      autosubs: {
        create: [
          {
            outgoingPlayerId: V1,
            replacementPlayerId: V2,
            outgoingSlot: 'RUC',
            outgoingSlotIndex: 0,
            interchangeSlotIndex: 0,
            reason: 'DID_NOT_PLAY',
          },
        ],
      },
    },
  });
  await prisma.leagueLineup.create({
    data: {
      leagueId: LEAGUE,
      seasonId: SEASON,
      memberId: BS,
      round: 1,
      players: {
        create: [
          { playerId: B1, slot: 'MID', slotIndex: 0 },
          { playerId: B2, slot: 'BENCH', slotIndex: 0 },
        ],
      },
    },
  });
  const bite = await prisma.leagueBite.create({
    data: {
      leagueId: LEAGUE,
      seasonId: SEASON,
      roundId: round1.id,
      round: 1,
      matchupId: won.id,
      bloodsuckerMemberId: BS,
      victimMemberId: VICTIM,
      grantedWinnerMemberId: BS,
      opensAt: new Date(NOW.getTime() - 20 * HOUR),
      deadlineAt: new Date(NOW.getTime() + 28 * HOUR),
    },
  });
  biteId = bite.id;
}

beforeEach(() => seed());
afterAll(async () => {
  await removeFixture();
  await prisma.$disconnect();
});

describe('loadBloodsuckerSummary (BR-40)', () => {
  it("shows every member the Bloodsucker, its current-fixture record and this season's bites", async () => {
    await prisma.leagueBite.update({
      where: { id: biteId },
      data: { status: 'EXECUTED', takenPlayerId: V2, returnedPlayerId: B2, executedAt: NOW },
    });

    const summary = await loadBloodsuckerSummary({ leagueId: LEAGUE, userId: USERS.victim });

    expect(summary.bloodsucker).toEqual({ memberId: BS, teamName: 'Suckers' });
    expect(summary.record).toEqual({ wins: 1, losses: 1, draws: 1 });
    expect(summary.viewer).toEqual({ memberId: VICTIM, isBloodsucker: false });
    expect(summary.bites).toEqual([
      expect.objectContaining({
        round: 1,
        status: 'EXECUTED',
        victim: { memberId: VICTIM, teamName: 'Victims' },
        takenPlayer: { id: V2, name: 'Player 2' },
        returnedPlayer: { id: B2, name: 'Player 5' },
      }),
    ]);
  });

  it('refuses someone who is not a member', async () => {
    const error = await loadBloodsuckerSummary({ leagueId: LEAGUE, userId: 'nobody' }).catch(
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(BloodsuckerReadError);
    expect((error as BloodsuckerReadError).status).toBe(403);
  });
});

describe('loadBitePicker (US-6)', () => {
  it('groups both rosters by slot after autosubs and previews the auto-bite', async () => {
    const picker = await loadBitePicker({ leagueId: LEAGUE, biteId, userId: USERS.bs, now: NOW });

    expect(picker.blocked).toBeNull();
    expect(picker.score).toBe('5-4');
    expect(picker.victim).toEqual({ memberId: VICTIM, teamName: 'Victims' });
    expect(picker.deadlineAt).toBe(new Date(NOW.getTime() + 28 * HOUR).toISOString());
    expect(picker.victimPlayers.map((player) => [player.id, player.group])).toEqual([
      [V2, 'RUC'],
      [V1, 'NON_SCORING'],
      [V3, 'NON_SCORING'],
    ]);
    expect(picker.returnPlayers.map((player) => [player.id, player.group])).toEqual([
      [B1, 'MID'],
      [B2, 'NON_SCORING'],
    ]);
    expect(picker.autoBitePreview).toEqual({ takenPlayerId: V2, returnedPlayerId: B2 });
  });

  it('names the refusal while a round is in progress (E8)', async () => {
    await seed({ roundTwoStartsAt: new Date(NOW.getTime() - HOUR) });

    const picker = await loadBitePicker({ leagueId: LEAGUE, biteId, userId: USERS.bs, now: NOW });

    expect(picker.blocked).toEqual({
      code: 'ROUND_IN_PROGRESS',
      message: expect.stringContaining('Round 2 is in progress'),
    });
  });

  it('is for the Bloodsucker only', async () => {
    const error = await loadBitePicker({ leagueId: LEAGUE, biteId, userId: USERS.victim }).catch(
      (caught: unknown) => caught
    );
    expect((error as BloodsuckerReadError).code).toBe('FORBIDDEN');
  });
});
