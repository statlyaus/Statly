/**
 * #1355, E12: the Bloodsucker's opponent is frozen from the end of their round, not from the grant.
 * The bite is granted in the transaction that makes the round FINAL, so the time to close is between
 * the round's end and its scoring; after it, the BR-30 freeze covers adds as well as drops and trades.
 * Runs against PostgreSQL through the real drop route, trade service, add and waiver settlement.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/waivers/WaiverAvailabilityProjectionService', () => ({
  WaiverAvailabilityProjectionService: class {
    projectLeague = vi.fn().mockResolvedValue({ owned: 0, available: 0 });
  },
}));

const auth = vi.hoisted(() => ({ userId: '' }));
vi.mock('@/lib/serverAuth', () => ({ getAuthenticatedUserId: vi.fn(async () => auth.userId) }));
vi.mock('@/lib/leagueMembership', () => ({
  verifyLeagueMembership: vi.fn().mockResolvedValue({ isMember: true }),
}));

import type { NextRequest } from 'next/server';

import { POST as postTeamAction } from '@/app/api/leagues/[id]/actions/[userId]/route';

import { prisma } from '@/lib/prisma';
import { findBiteFreeze, listBiteFrozenMembers } from '@/server/leagues/bitePending';
import { commissionerBiteAction } from '@/server/leagues/bloodsuckerBites';
import { createLeagueTrade } from '@/server/leagues/trades/tradeService';
import { addFreeAgentToRoster } from '@/server/rosters/freeAgentAdd';
import {
  PrismaWaiverClaimStore,
  WaiverProcessingService,
} from '@/server/waivers/WaiverProcessingService';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';

const P = 'int-bs-freeze';
const LEAGUE = `${P}-league`;
const SETTINGS = `${P}-settings`;
const SEASON = `${P}-2026`;
const USERS = { owner: `${P}-u-owner`, bs: `${P}-u-bs`, victim: `${P}-u-victim` };
const OWNER = `${P}-owner`;
const BS = `${P}-bs`;
const VICTIM = `${P}-victim`;
// v1, v2 on the victim; b1 on the Bloodsucker; o1 on the owner; f1, f2 are free agents.
const PLAYERS = ['v1', 'v2', 'b1', 'o1', 'f1', 'f2'].map((key) => `${P}-${key}`);
const [V1, V2, B1, O1, F1, F2] = PLAYERS as [string, string, string, string, string, string];
const HOUR = 60 * 60 * 1000;
const NOW = new Date();

const firestoreDoc = {
  get: async () => ({ exists: false, data: () => undefined }),
  set: async () => undefined,
  update: async () => undefined,
};
const firestore = { doc: () => firestoreDoc, collection: () => ({ doc: () => firestoreDoc }) };
const waiverStore = new PrismaWaiverClaimStore(prisma, firestore as never);
const waivers = new WaiverProcessingService(prisma, waiverStore, {
  projectLeague: async () => ({ owned: 0, available: 0 }),
} as never);

const removeFixture = () =>
  deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE],
    playerIds: PLAYERS,
    settingsIds: [SETTINGS],
    userIds: Object.values(USERS),
  });

let matchupId = '';
let roundId = '';

/** Round 1 (Bloodsucker v victim) has ended an hour ago and is not scored yet. */
async function seed() {
  await removeFixture();
  await prisma.user.createMany({
    data: Object.values(USERS).map((id) => ({
      id,
      email: `${id}@statly.local`,
      passwordHash: 'x',
      displayName: id,
    })),
  });
  await prisma.player.createMany({
    data: PLAYERS.map((id) => ({ id, name: id, club: 'GWS', position: 'MID' })),
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
      tradeReviewMode: 'NONE',
    },
  });
  await prisma.league.create({
    data: {
      id: LEAGUE,
      name: 'Loser freeze',
      inviteCode: 'INTBSFRZ',
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
  await prisma.draft.create({
    data: {
      leagueId: LEAGUE,
      status: 'COMPLETED',
      totalPicks: 0,
      completedAt: new Date(NOW.getTime() - 30 * 24 * HOUR),
    },
  });
  await prisma.leagueRosterPlayer.createMany({
    data: [
      { leagueId: LEAGUE, memberId: VICTIM, playerId: V1 },
      { leagueId: LEAGUE, memberId: VICTIM, playerId: V2 },
      { leagueId: LEAGUE, memberId: BS, playerId: B1 },
      { leagueId: LEAGUE, memberId: OWNER, playerId: O1 },
    ],
  });
  const round1 = await prisma.leagueCompetitionRound.create({
    data: {
      leagueId: LEAGUE,
      seasonId: SEASON,
      fixtureVersion: 1,
      round: 1,
      status: 'SCHEDULED',
      startsAt: new Date(NOW.getTime() - 72 * HOUR),
      endsAt: new Date(NOW.getTime() - HOUR),
    },
  });
  roundId = round1.id;
  await prisma.leagueCompetitionRound.create({
    data: {
      leagueId: LEAGUE,
      seasonId: SEASON,
      fixtureVersion: 1,
      round: 2,
      startsAt: new Date(NOW.getTime() + 72 * HOUR),
      endsAt: new Date(NOW.getTime() + 120 * HOUR),
    },
  });
  const matchup = await prisma.leagueMatchup.create({
    data: {
      leagueId: LEAGUE,
      round: 1,
      fixtureVersion: 1,
      competitionRoundId: round1.id,
      homeMemberId: BS,
      awayMemberId: VICTIM,
      status: 'LIVE',
    },
  });
  matchupId = matchup.id;
}

/** What the scoring transaction stores when round 1 goes FINAL with this winner. */
async function finalise(winnerMemberId: string) {
  await prisma.leagueCompetitionRound.update({ where: { id: roundId }, data: { status: 'FINAL' } });
  await prisma.leagueMatchup.update({
    where: { id: matchupId },
    data: { status: 'FINAL', winnerMemberId },
  });
  if (winnerMemberId !== BS) return null;
  return prisma.leagueBite.create({
    data: {
      leagueId: LEAGUE,
      seasonId: SEASON,
      roundId,
      round: 1,
      matchupId,
      bloodsuckerMemberId: BS,
      victimMemberId: VICTIM,
      grantedWinnerMemberId: BS,
      opensAt: NOW,
      deadlineAt: new Date(NOW.getTime() + 48 * HOUR),
    },
  });
}

const propose = (userId: string, recipientMemberId: string, send: string, receive: string) =>
  createLeagueTrade(
    LEAGUE,
    userId,
    {
      recipientMemberId,
      sendingPlayerIds: [send],
      receivingPlayerIds: [receive],
      idempotencyKey: `${P}-trade-${Math.random()}`,
    },
    NOW
  );

const add = (userId: string, playerId: string) =>
  addFreeAgentToRoster(prisma, {
    leagueId: LEAGUE,
    userId,
    playerId,
    playerAliasIds: [playerId],
    now: NOW,
  });

async function drop(userId: string, playerId: string) {
  auth.userId = userId;
  const response = await postTeamAction(
    new Request(`https://statly.test/api/leagues/${LEAGUE}/actions/${userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionType: 'DROP_PLAYER', details: { playerId } }),
    }) as unknown as NextRequest,
    { params: Promise.resolve({ id: LEAGUE, userId }) }
  );
  if (!response) throw new Error('POST returned no response');
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function runWaivers() {
  await prisma.teamAction.updateMany({
    where: { leagueId: LEAGUE, actionType: 'WAIVER_CLAIM', status: 'PENDING' },
    data: { processingAt: new Date(Date.now() - 60_000) },
  });
  return waivers.processLeague({ leagueId: LEAGUE });
}

const ownerOf = async (playerId: string) =>
  (await prisma.leagueRosterPlayer.findFirst({ where: { leagueId: LEAGUE, playerId } }))?.memberId;

/** The victim's trade, drop and add are all refused with `code`, and nothing moved. */
async function expectVictimFrozen(code: string) {
  await expect(propose(USERS.victim, OWNER, V2, O1)).rejects.toMatchObject({ code, status: 409 });
  await expect(drop(USERS.victim, V1)).resolves.toMatchObject({ status: 409, body: { code } });
  await expect(add(USERS.victim, F1)).rejects.toMatchObject({ code, status: 409 });
  // A trade somebody else starts with the frozen team cannot complete either.
  await expect(propose(USERS.owner, VICTIM, O1, V2)).resolves.toBeTruthy();
  expect(await ownerOf(V1)).toBe(VICTIM);
  expect(await ownerOf(V2)).toBe(VICTIM);
  expect(await ownerOf(F1)).toBeUndefined();
}

describe.sequential('Bloodsucker loser freeze from round end (#1355, E12)', () => {
  beforeEach(seed);
  afterAll(removeFixture);

  it('does not freeze anyone while the round has not ended', async () => {
    await prisma.leagueCompetitionRound.update({
      where: { id: roundId },
      data: { endsAt: new Date(NOW.getTime() + HOUR) },
    });
    await expect(findBiteFreeze(prisma, LEAGUE, VICTIM, NOW)).resolves.toBeNull();
  });

  it("refuses the opponent's trade, drop and add between round end and the final result", async () => {
    await expectVictimFrozen('BLOODSUCKER_RESULT_PENDING');
    await expect(listBiteFrozenMembers(prisma, LEAGUE, NOW)).resolves.toEqual(
      new Map([[VICTIM, 'BLOODSUCKER_RESULT_PENDING']])
    );

    // Only the Bloodsucker's opponent is frozen: the other teams carry on.
    await expect(findBiteFreeze(prisma, LEAGUE, BS, NOW)).resolves.toBeNull();
    await expect(add(USERS.owner, F2)).resolves.toMatchObject({ memberId: OWNER });
  });

  it('keeps the loser frozen from the final result until the bite is cancelled', async () => {
    const bite = await finalise(BS);
    await expectVictimFrozen('BITE_PENDING');

    // A claim that only adds waits too.
    await waiverStore.submitClaim({
      leagueId: LEAGUE,
      userId: USERS.victim,
      teamId: VICTIM,
      playerId: F2,
      priority: 1,
      waiverSettings: { system: 'PRIORITY' },
    });
    await runWaivers();
    expect(await ownerOf(F2)).toBeUndefined();

    await commissionerBiteAction({
      leagueId: LEAGUE,
      biteId: bite!.id,
      userId: USERS.owner,
      body: { action: 'cancel', reason: 'Scoring error' },
      now: NOW,
    });
    await expect(findBiteFreeze(prisma, LEAGUE, VICTIM, NOW)).resolves.toBeNull();
    await runWaivers();
    expect(await ownerOf(F2)).toBe(VICTIM);
    await expect(drop(USERS.victim, V1)).resolves.toMatchObject({ status: 200 });
    await expect(add(USERS.victim, F1)).resolves.toMatchObject({ memberId: VICTIM });
    await expect(propose(USERS.victim, OWNER, V2, O1)).resolves.toBeTruthy();
  });

  it('frees the opponent at once when the Bloodsucker did not win', async () => {
    await finalise(VICTIM);
    await expect(findBiteFreeze(prisma, LEAGUE, VICTIM, NOW)).resolves.toBeNull();
    await expect(add(USERS.victim, F1)).resolves.toMatchObject({ memberId: VICTIM });
    await expect(drop(USERS.victim, V1)).resolves.toMatchObject({ status: 200 });
  });

  it('ignores a matchup on an old fixture or in another season', async () => {
    await prisma.leagueSettings.update({
      where: { id: SETTINGS },
      data: { competitionRulesVersion: 2 },
    });
    await expect(findBiteFreeze(prisma, LEAGUE, VICTIM, NOW)).resolves.toBeNull();

    await prisma.leagueSettings.update({
      where: { id: SETTINGS },
      data: { competitionRulesVersion: 1 },
    });
    await expect(findBiteFreeze(prisma, LEAGUE, VICTIM, NOW)).resolves.not.toBeNull();
    const other = await prisma.leagueSeason.create({
      data: { leagueId: LEAGUE, label: '2027 season', year: 2027 },
    });
    await prisma.league.update({ where: { id: LEAGUE }, data: { activeSeasonId: other.id } });
    await expect(findBiteFreeze(prisma, LEAGUE, VICTIM, NOW)).resolves.toBeNull();
  });
});
