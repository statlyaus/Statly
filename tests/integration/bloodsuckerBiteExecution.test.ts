/**
 * Bloodsucker 6/9 (#1283): executing a bite, the victim freeze and commissioner cancel or redo
 * (BR-21, BR-24 to BR-26, BR-30, BR-35, BR-38, BR-39; owner decisions E1, E2, E5, E7, E8). Runs
 * against PostgreSQL for the League row lock, the owner-filtered swap and concurrent writers.
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

import type { LeagueBite } from '@prisma/client';
import type { NextRequest } from 'next/server';

import { POST as postTeamAction } from '@/app/api/leagues/[id]/actions/[userId]/route';

import { prisma } from '@/lib/prisma';
import { hasPendingBite } from '@/server/leagues/bitePending';
import {
  BiteError,
  commissionerBiteAction,
  executeBite,
  isBloodsuckerRoundSelfOverride,
} from '@/server/leagues/bloodsuckerBites';
import { lockLeagueRow, lockLeagueRowOrBusy } from '@/server/leagues/leagueRowLock';
import { swapRosterPlayers } from '@/server/leagues/rosterSwap';
import { createLeagueTrade } from '@/server/leagues/trades/tradeService';
import {
  PrismaWaiverClaimStore,
  WaiverProcessingService,
} from '@/server/waivers/WaiverProcessingService';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';

const P = 'int-bite-exec';
const LEAGUE = `${P}-league`;
const SETTINGS = `${P}-settings`;
const SEASON = `${P}-2026`;
const USERS = { owner: `${P}-u-owner`, bs: `${P}-u-bs`, victim: `${P}-u-victim` };
const OWNER = `${P}-owner`;
const BS = `${P}-bs`;
const VICTIM = `${P}-victim`;
// Players: v1, v2 on the victim; b1, b2 on the Bloodsucker; o1 on the owner.
const PLAYERS = ['v1', 'v2', 'b1', 'b2', 'o1', 'f1'].map((key) => `${P}-${key}`);
const [V1, V2, B1, B2, O1, F1] = PLAYERS as [string, string, string, string, string, string];
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

async function claimDropping(userId: string, teamId: string, dropPlayerId: string) {
  await waiverStore.submitClaim({
    leagueId: LEAGUE,
    userId,
    teamId,
    playerId: F1,
    dropPlayerId,
    priority: 1,
    waiverSettings: { system: 'PRIORITY' },
  });
}

async function runWaivers() {
  await prisma.teamAction.updateMany({
    where: { leagueId: LEAGUE, actionType: 'WAIVER_CLAIM', status: 'PENDING' },
    data: { processingAt: new Date(Date.now() - 60_000) },
  });
  return waivers.processLeague({ leagueId: LEAGUE });
}

const removeFixture = () =>
  deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE],
    playerIds: PLAYERS,
    settingsIds: [SETTINGS],
    userIds: Object.values(USERS),
  });

let matchupId = '';
let roundId = '';

async function seed(options: { roundTwoStartsAt?: Date } = {}) {
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
    // Listed RUC/MID, so each suits the RUC slot the fixture lineups put a player in.
    data: PLAYERS.map((id) => ({ id, name: id, club: 'GWS', position: 'RUC/MID' })),
  });
  await prisma.leagueSettings.create({
    data: {
      id: SETTINGS,
      rosterSize: 2,
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
      name: 'Bite exec',
      inviteCode: 'INTBITEX',
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
      { leagueId: LEAGUE, memberId: BS, playerId: B2 },
      { leagueId: LEAGUE, memberId: OWNER, playerId: O1 },
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
  roundId = round1.id;
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
  const matchup = await prisma.leagueMatchup.create({
    data: {
      leagueId: LEAGUE,
      round: 1,
      fixtureVersion: 1,
      competitionRoundId: round1.id,
      homeMemberId: BS,
      awayMemberId: VICTIM,
      status: 'FINAL',
      winnerMemberId: BS,
      homeCategoryWins: 5,
      awayCategoryWins: 4,
    },
  });
  matchupId = matchup.id;
  // Round 1 is scored history; round 2 is the open lineup the swap must update (BR-25).
  for (const [memberId, players] of [
    [VICTIM, [V1, V2]],
    [BS, [B1, B2]],
  ] as const) {
    for (const round of [1, 2]) {
      await prisma.leagueLineup.create({
        data: {
          leagueId: LEAGUE,
          seasonId: SEASON,
          memberId,
          round,
          players: {
            create: [
              { playerId: players[0], slot: 'RUC', slotIndex: 0 },
              { playerId: players[1], slot: 'BENCH', slotIndex: 0 },
            ],
          },
        },
      });
    }
  }
  return grantBite({ round: 1, matchupId: matchup.id, roundId: round1.id });
}

function grantBite(input: { round: number; matchupId: string; roundId: string; opensAt?: Date }) {
  return prisma.leagueBite.create({
    data: {
      leagueId: LEAGUE,
      seasonId: SEASON,
      roundId: input.roundId,
      round: input.round,
      matchupId: input.matchupId,
      bloodsuckerMemberId: BS,
      victimMemberId: VICTIM,
      grantedWinnerMemberId: BS,
      opensAt: input.opensAt ?? new Date(NOW.getTime() - 20 * HOUR),
      deadlineAt: new Date(NOW.getTime() + 28 * HOUR),
    },
  });
}

const bite = (body: unknown, biteId: string, userId = USERS.bs) =>
  executeBite({ leagueId: LEAGUE, biteId, userId, body, now: NOW });
const commish = (body: unknown, biteId: string, userId = USERS.owner) =>
  commissionerBiteAction({ leagueId: LEAGUE, biteId, userId, body, now: NOW });

const ownerOf = async (playerId: string) =>
  (await prisma.leagueRosterPlayer.findFirst({ where: { leagueId: LEAGUE, playerId } }))?.memberId;

const lineupSlots = async (memberId: string, round: number) =>
  (
    await prisma.leagueLineupPlayer.findMany({
      where: { lineup: { leagueId: LEAGUE, memberId, round } },
      select: { playerId: true, slot: true },
    })
  )
    .map((row) => `${row.slot}:${row.playerId}`)
    .sort();

/** Holds the League row, as round scoring does, for `ms`. */
function holdLeagueRow(ms: number) {
  let locked!: () => void;
  const ready = new Promise<void>((resolve) => (locked = resolve));
  const released = prisma.$transaction(
    async (tx) => {
      await lockLeagueRow(tx, LEAGUE);
      locked();
      await new Promise((resolve) => setTimeout(resolve, ms));
    },
    { timeout: ms + 5_000 }
  );
  return { ready, released };
}

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

async function expectBiteError(promise: Promise<unknown>, code: string, status: number) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(BiteError);
  expect(error).toMatchObject({ code, status });
}

describe.sequential('Bloodsucker bite execution', () => {
  let granted: LeagueBite;
  beforeEach(async () => {
    granted = await seed();
  });
  afterAll(removeFixture);

  it('swaps both players, updates open lineups, invalidates trades and claims, and audits', async () => {
    // A pending trade with the taken player, and a victim claim that would drop him.
    const thread = await prisma.leagueTradeThread.create({
      data: { leagueId: LEAGUE, seasonId: SEASON, memberOneId: OWNER, memberTwoId: VICTIM },
    });
    const offer = await prisma.leagueTradeOffer.create({
      data: {
        threadId: thread.id,
        sequence: 1,
        proposerMemberId: OWNER,
        recipientMemberId: VICTIM,
        expiresAt: new Date(NOW.getTime() + 48 * HOUR),
        reviewMode: 'NONE',
        reviewHours: 0,
        vetoThreshold: 0,
        players: {
          create: [
            {
              playerId: V1,
              playerNameSnapshot: V1,
              playerClubSnapshot: 'GWS',
              playerPositionSnapshot: 'MID',
              fromMemberId: VICTIM,
              toMemberId: OWNER,
            },
          ],
        },
      },
    });
    await prisma.leagueTradeThread.update({
      where: { id: thread.id },
      data: { currentOfferId: offer.id },
    });
    const claim = await prisma.teamAction.create({
      data: {
        leagueId: LEAGUE,
        seasonId: SEASON,
        memberId: VICTIM,
        actionType: 'WAIVER_CLAIM',
        details: { playerId: 'someone', dropPlayerId: V1 },
      },
    });

    const result = await bite({ takenPlayerId: V1, returnedPlayerId: B2 }, granted.id);

    expect(result).toMatchObject({ status: 'EXECUTED', takenPlayerId: V1, returnedPlayerId: B2 });
    expect(await ownerOf(V1)).toBe(BS);
    expect(await ownerOf(B2)).toBe(VICTIM);
    // E2: a starting RUC for a bench player is allowed; the incoming player takes the slot (BR-25).
    expect(await lineupSlots(VICTIM, 2)).toEqual([`RUC:${B2}`, `BENCH:${V2}`].sort());
    expect(await lineupSlots(BS, 2)).toEqual([`RUC:${B1}`, `BENCH:${V1}`].sort());
    // The scored round never changes.
    expect(await lineupSlots(VICTIM, 1)).toEqual([`RUC:${V1}`, `BENCH:${V2}`].sort());
    expect(
      await prisma.leagueTradeEvent.findFirst({
        where: { threadId: thread.id, eventType: 'INVALIDATED' },
      })
    ).toMatchObject({ reasonCode: 'PLAYER_BITTEN' });
    expect(await prisma.teamAction.findUnique({ where: { id: claim.id } })).toMatchObject({
      status: 'REJECTED',
      details: { failureReason: 'PLAYER_BITTEN' },
    });
    const stored = await prisma.leagueBite.findUniqueOrThrow({ where: { id: granted.id } });
    expect(stored).toMatchObject({
      status: 'EXECUTED',
      takenSlot: 'RUC',
      executedByUserId: USERS.bs,
    });
    const audit = await prisma.leagueCompetitionAudit.findFirstOrThrow({
      where: { leagueId: LEAGUE, eventType: 'BITE_EXECUTED' },
    });
    expect(audit).toMatchObject({
      actorMemberId: BS,
      payloadJson: {
        biteId: granted.id,
        matchupId,
        takenPlayerId: V1,
        returnedPlayerId: B2,
        rostersBefore: { bloodsucker: [B1, B2], victim: [V1, V2] },
        rostersAfter: { bloodsucker: [B1, V1], victim: [B2, V2] },
      },
    });
    expect(
      await prisma.teamAction.count({
        where: { leagueId: LEAGUE, actionType: 'BLOODSUCKER_BITE' },
      })
    ).toBe(1);
    const messages = await prisma.socialMessage.findMany({
      where: { leagueId: LEAGUE },
      select: { content: true },
    });
    expect(messages.map((message) => message.content)).toEqual([
      `The Bloodsucker beat Victims 5-4 and took ${V1}, sending back ${B2}.`,
    ]);

    // A second execution is refused and changes nothing.
    await expectBiteError(
      bite({ takenPlayerId: V2, returnedPlayerId: B1 }, granted.id),
      'BITE_NOT_OPEN',
      409
    );
  });

  it('refuses anyone but the Bloodsucker, a bad pair, and an executed swap stays put', async () => {
    await expectBiteError(
      bite({ takenPlayerId: V1, returnedPlayerId: B2 }, granted.id, USERS.owner),
      'FORBIDDEN',
      403
    );
    await expectBiteError(bite({ takenPlayerId: V1 }, granted.id), 'INVALID_INPUT', 400);
    await expectBiteError(
      bite({ takenPlayerId: O1, returnedPlayerId: B2 }, granted.id),
      'ROSTER_CHANGED',
      409
    );
    expect(await ownerOf(O1)).toBe(OWNER);
  });

  it('refuses while a round is in progress (E8) or the matchup is not FINAL (E5)', async () => {
    await prisma.leagueCompetitionRound.updateMany({
      where: { leagueId: LEAGUE, round: 2 },
      data: { startsAt: new Date(NOW.getTime() - HOUR) },
    });
    await expectBiteError(
      bite({ takenPlayerId: V1, returnedPlayerId: B2 }, granted.id),
      'ROUND_IN_PROGRESS',
      409
    );

    await prisma.leagueCompetitionRound.updateMany({
      where: { leagueId: LEAGUE, round: 2 },
      data: { startsAt: new Date(NOW.getTime() + 72 * HOUR) },
    });
    await prisma.leagueMatchup.update({ where: { id: matchupId }, data: { status: 'LIVE' } });
    await expectBiteError(
      bite({ takenPlayerId: V1, returnedPlayerId: B2 }, granted.id),
      'BITE_SUSPENDED',
      409
    );
    expect(await ownerOf(V1)).toBe(VICTIM);
  });

  it('executes the oldest open bite first (E7)', async () => {
    const laterMatchup = await prisma.leagueMatchup.create({
      data: {
        leagueId: LEAGUE,
        round: 3,
        fixtureVersion: 1,
        homeMemberId: VICTIM,
        awayMemberId: BS,
        status: 'FINAL',
        winnerMemberId: BS,
      },
    });
    const later = await grantBite({
      round: 3,
      matchupId: laterMatchup.id,
      roundId,
      opensAt: NOW,
    });

    await expectBiteError(
      bite({ takenPlayerId: V2, returnedPlayerId: B1 }, later.id),
      'EARLIER_BITE_PENDING',
      409
    );
    await bite({ takenPlayerId: V1, returnedPlayerId: B2 }, granted.id);
    await expect(
      bite({ takenPlayerId: V2, returnedPlayerId: B1 }, later.id)
    ).resolves.toMatchObject({ status: 'EXECUTED' });
  });

  it('freezes the victim: trade proposals are refused with BITE_PENDING until the bite is done', async () => {
    const propose = () =>
      createLeagueTrade(
        LEAGUE,
        USERS.victim,
        {
          recipientMemberId: OWNER,
          sendingPlayerIds: [V2],
          receivingPlayerIds: [O1],
          idempotencyKey: `${P}-trade-${Math.random()}`,
        },
        NOW
      );
    await expect(propose()).rejects.toMatchObject({ code: 'BITE_PENDING', status: 409 });

    await bite({ takenPlayerId: V1, returnedPlayerId: B2 }, granted.id);
    await expect(propose()).resolves.toBeTruthy();
  });

  it('gives no lost or double move when a bite and a trade race for the same player', async () => {
    const trade = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "League" WHERE id = ${LEAGUE} FOR UPDATE`;
      await swapRosterPlayers(tx, {
        leagueId: LEAGUE,
        seasonId: SEASON,
        fromMemberId: VICTIM,
        toMemberId: OWNER,
        fromPlayerIds: [V1],
        toPlayerIds: [O1],
        acquiredBy: 'TRADE',
        invalidationReason: 'TRADE_COMPLETED',
        now: NOW,
      });
    });
    const results = await Promise.allSettled([
      bite({ takenPlayerId: V1, returnedPlayerId: B2 }, granted.id),
      trade,
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rows = await prisma.leagueRosterPlayer.findMany({
      where: { leagueId: LEAGUE, playerId: V1 },
    });
    expect(rows).toHaveLength(1);
    const stored = await prisma.leagueBite.findUniqueOrThrow({ where: { id: granted.id } });
    expect(stored.status === 'EXECUTED').toBe(rows[0]!.memberId === BS);
  });

  it("holds the victim's claim that drops a player until the bite is done (BR-30)", async () => {
    await claimDropping(USERS.victim, VICTIM, V2);

    await runWaivers();
    expect(await ownerOf(V2)).toBe(VICTIM);
    expect(await ownerOf(F1)).toBeUndefined();

    await bite({ takenPlayerId: V1, returnedPlayerId: B2 }, granted.id);
    await runWaivers();
    expect(await ownerOf(V2)).toBeUndefined();
    expect(await ownerOf(F1)).toBe(VICTIM);
  });

  it('gives no lost or double move when a bite and a waiver run race for the same player', async () => {
    // The Bloodsucker's claim would drop the player its bite sends back.
    await claimDropping(USERS.bs, BS, B2);

    const [biteResult] = await Promise.allSettled([
      bite({ takenPlayerId: V1, returnedPlayerId: B2 }, granted.id),
      runWaivers(),
    ]);

    const b2Rows = await prisma.leagueRosterPlayer.findMany({
      where: { leagueId: LEAGUE, playerId: B2 },
    });
    expect(b2Rows.length).toBeLessThanOrEqual(1);
    if (biteResult.status === 'fulfilled') {
      expect(b2Rows[0]?.memberId).toBe(VICTIM);
      expect(await ownerOf(F1)).toBeUndefined();
    } else {
      expect(biteResult.reason).toMatchObject({ code: 'ROSTER_CHANGED' });
      expect(b2Rows).toEqual([]);
      expect(await ownerOf(F1)).toBe(BS);
      expect(await ownerOf(V1)).toBe(VICTIM);
    }
  });

  it('runs one of two concurrent executions of the same bite', async () => {
    const results = await Promise.allSettled([
      bite({ takenPlayerId: V1, returnedPlayerId: B2 }, granted.id),
      bite({ takenPlayerId: V2, returnedPlayerId: B1 }, granted.id),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      await prisma.leagueCompetitionAudit.count({
        where: { leagueId: LEAGUE, eventType: 'BITE_EXECUTED' },
      })
    ).toBe(1);
  });

  describe('commissioner cancel and redo (BR-35, E1)', () => {
    it('refuses the Bloodsucker and the victim, and requires a reason', async () => {
      await prisma.leagueMember.update({ where: { id: VICTIM }, data: { isCoCommissioner: true } });
      await expectBiteError(
        commish({ action: 'cancel', reason: 'mine' }, granted.id, USERS.victim),
        'FORBIDDEN',
        403
      );
      await prisma.leagueMember.update({ where: { id: BS }, data: { isCoCommissioner: true } });
      await expectBiteError(
        commish({ action: 'cancel', reason: 'mine' }, granted.id, USERS.bs),
        'FORBIDDEN',
        403
      );
      await expectBiteError(commish({ action: 'cancel' }, granted.id), 'INVALID_INPUT', 400);
    });

    it('blocks the Bloodsucker and its opponent from recalculating that round (BR-34, E1)', async () => {
      const blocked = (memberId: string, round = 1) =>
        isBloodsuckerRoundSelfOverride({ leagueId: LEAGUE, round, memberId });
      await expect(blocked(BS)).resolves.toBe(true);
      await expect(blocked(VICTIM)).resolves.toBe(true);
      await expect(blocked(OWNER)).resolves.toBe(false);
      await expect(blocked(BS, 2)).resolves.toBe(false);
    });

    it('cancels an open bite, which then stops freezing the victim', async () => {
      await expect(
        commish({ action: 'cancel', reason: 'Scoring error' }, granted.id)
      ).resolves.toMatchObject({ status: 'CANCELLED' });
      expect(
        await prisma.leagueBite.findUniqueOrThrow({ where: { id: granted.id } })
      ).toMatchObject({ cancelledBy: 'COMMISSIONER', cancelledReason: 'Scoring error' });
      expect(
        await prisma.leagueCompetitionAudit.findFirst({
          where: { leagueId: LEAGUE, eventType: 'BITE_CANCELLED' },
        })
      ).toMatchObject({ actorMemberId: OWNER, payloadJson: { reason: 'Scoring error' } });
    });

    it('redoes an executed bite as a new swap, and cancelling it swaps the players back', async () => {
      await bite({ takenPlayerId: V1, returnedPlayerId: B2 }, granted.id);

      await commish(
        { action: 'redo', reason: 'Wrong player', takenPlayerId: V2, returnedPlayerId: B1 },
        granted.id
      );
      expect(await ownerOf(V1)).toBe(VICTIM);
      expect(await ownerOf(B2)).toBe(BS);
      expect(await ownerOf(V2)).toBe(BS);
      expect(await ownerOf(B1)).toBe(VICTIM);
      expect(
        await prisma.leagueBite.findUniqueOrThrow({ where: { id: granted.id } })
      ).toMatchObject({ status: 'EXECUTED', takenPlayerId: V2, returnedPlayerId: B1 });
      expect(
        await prisma.leagueCompetitionAudit.count({
          where: { leagueId: LEAGUE, eventType: 'BITE_REDONE' },
        })
      ).toBe(1);

      await commish({ action: 'cancel', reason: 'Void it' }, granted.id);
      expect(await ownerOf(V2)).toBe(VICTIM);
      expect(await ownerOf(B1)).toBe(BS);
      expect((await prisma.socialMessage.findMany({ where: { leagueId: LEAGUE } })).length).toBe(3);
    });
  });

  describe('review fixes (#1343)', () => {
    it('leaves an arriving player out of a lineup slot he is not listed for', async () => {
      // B2 is a defender: he cannot take over V1's RUC slot in the victim's open round 2 lineup.
      await prisma.player.update({ where: { id: B2 }, data: { position: 'DEF' } });

      await bite({ takenPlayerId: V1, returnedPlayerId: B2 }, granted.id);

      expect(await ownerOf(B2)).toBe(VICTIM);
      expect(await lineupSlots(VICTIM, 2)).toEqual([`BENCH:${V2}`]);
      // V1 suits the bench spot B2 left, and scored round 1 is untouched.
      expect(await lineupSlots(BS, 2)).toEqual([`RUC:${B1}`, `BENCH:${V1}`].sort());
      expect(await lineupSlots(VICTIM, 1)).toEqual([`RUC:${V1}`, `BENCH:${V2}`].sort());
    });

    it('turns a redone auto-bite into a commissioner swap: EXECUTED, no stale snapshot, a team action', async () => {
      await bite({ takenPlayerId: V1, returnedPlayerId: B2 }, granted.id);
      const snapshot = { ruleVersion: 1, victim: [{ playerId: V1, z: 2 }], bloodsucker: [] };
      await prisma.leagueBite.update({
        where: { id: granted.id },
        data: {
          status: 'AUTO_EXECUTED',
          executedByUserId: null,
          autoBiteRuleVersion: 1,
          autoBiteSnapshotJson: snapshot,
        },
      });

      await expect(
        commish(
          { action: 'redo', reason: 'Wrong player', takenPlayerId: V2, returnedPlayerId: B1 },
          granted.id
        )
      ).resolves.toMatchObject({ status: 'EXECUTED', takenPlayerId: V2, returnedPlayerId: B1 });

      expect(
        await prisma.leagueBite.findUniqueOrThrow({ where: { id: granted.id } })
      ).toMatchObject({
        status: 'EXECUTED',
        executedByUserId: USERS.owner,
        autoBiteRuleVersion: null,
        autoBiteSnapshotJson: null,
      });
      const actions = await prisma.teamAction.findMany({
        where: { leagueId: LEAGUE, seasonId: SEASON, actionType: 'BLOODSUCKER_BITE' },
        orderBy: { createdAt: 'asc' },
      });
      expect(actions).toHaveLength(2);
      expect(actions[1]).toMatchObject({
        memberId: BS,
        targetMemberId: VICTIM,
        status: 'PROCESSED',
        details: { biteId: granted.id, takenPlayerId: V2, returnedPlayerId: B1, redo: true },
      });
      const audit = await prisma.leagueCompetitionAudit.findFirstOrThrow({
        where: { leagueId: LEAGUE, eventType: 'BITE_REDONE' },
      });
      expect(audit.payloadJson).toMatchObject({
        statusBefore: 'AUTO_EXECUTED',
        previous: { takenPlayerId: V1, autoBiteRuleVersion: 1, autoBiteSnapshot: snapshot },
      });
    });

    it('scopes the freeze and the oldest-first rule to the active season', async () => {
      await prisma.leagueSeason.create({
        data: { id: `${SEASON}-old`, leagueId: LEAGUE, label: '2025 season', year: 2025 },
      });
      await prisma.leagueBite.create({
        data: {
          leagueId: LEAGUE,
          seasonId: `${SEASON}-old`,
          roundId: `${P}-old-round`,
          round: 9,
          matchupId: `${P}-old-matchup`,
          bloodsuckerMemberId: BS,
          victimMemberId: VICTIM,
          grantedWinnerMemberId: BS,
          opensAt: new Date(NOW.getTime() - 400 * 24 * HOUR),
          deadlineAt: new Date(NOW.getTime() - 398 * 24 * HOUR),
        },
      });

      // Last season's open bite is not "earlier", and does not freeze the victim once this one is done.
      await expect(
        bite({ takenPlayerId: V1, returnedPlayerId: B2 }, granted.id)
      ).resolves.toMatchObject({ status: 'EXECUTED' });
      await expect(hasPendingBite(prisma, LEAGUE, VICTIM)).resolves.toBe(false);
    });

    it('waits for a League row held by scoring, and names LEAGUE_BUSY when the wait runs out', async () => {
      const short = holdLeagueRow(1_500);
      await short.ready;
      // A wait shorter than the hold is refused by name; a longer one gets the row.
      await expect(
        prisma.$transaction((tx) => lockLeagueRowOrBusy(tx, LEAGUE, 200))
      ).rejects.toMatchObject({ name: 'LeagueBusyError', code: 'LEAGUE_BUSY', status: 503 });
      await expect(
        prisma.$transaction((tx) => lockLeagueRowOrBusy(tx, LEAGUE, 10_000), { timeout: 15_000 })
      ).resolves.toBeUndefined();
      await short.released;

      // A manual bite outlasts Prisma's default 5-second transaction: it waits 6 seconds and runs.
      const long = holdLeagueRow(6_000);
      await long.ready;
      await expect(
        bite({ takenPlayerId: V1, returnedPlayerId: B2 }, granted.id)
      ).resolves.toMatchObject({ status: 'EXECUTED' });
      await long.released;
    });

    it('settles a waiver claim that had to wait more than 5 seconds for the League row', async () => {
      // The owner (no bite on him) claims the free agent, dropping O1. Scoring takes the League row
      // after the run has started (past its lease), so the settling transaction is what waits.
      await claimDropping(USERS.owner, OWNER, O1);
      await prisma.teamAction.updateMany({
        where: { leagueId: LEAGUE, actionType: 'WAIVER_CLAIM', status: 'PENDING' },
        data: { processingAt: new Date(Date.now() - 60_000) },
      });
      const [waiverSettings, claims] = await Promise.all([
        waiverStore.loadWaiverSettings(LEAGUE),
        waiverStore.loadPendingClaims(LEAGUE),
      ]);
      expect(claims).toHaveLength(1);
      const held = holdLeagueRow(6_000);
      await held.ready;

      await waivers.processClaims({ leagueId: LEAGUE, waiverSettings, claims });

      await held.released;
      expect(await ownerOf(F1)).toBe(OWNER);
      expect(await ownerOf(O1)).toBeUndefined();
    });

    it('refuses a manual bite with LEAGUE_BUSY, not a bare 500, when the League row stays held', async () => {
      const held = holdLeagueRow(9_500);
      await held.ready;

      await expectBiteError(
        bite({ takenPlayerId: V1, returnedPlayerId: B2 }, granted.id),
        'LEAGUE_BUSY',
        503
      );

      await held.released;
      expect(await ownerOf(V1)).toBe(VICTIM);
    });

    it('stops the Bloodsucker dropping its last player while it holds a bite', async () => {
      await expect(drop(USERS.bs, B1)).resolves.toMatchObject({ status: 200 });
      await expect(drop(USERS.bs, B2)).resolves.toMatchObject({
        status: 409,
        body: { code: 'LAST_PLAYER_BITE_HELD', error: expect.stringContaining('last player') },
      });
      expect(await ownerOf(B2)).toBe(BS);

      // With the bite done (here: cancelled) it may drop him.
      await commish({ action: 'cancel', reason: 'Scoring error' }, granted.id);
      await expect(drop(USERS.bs, B2)).resolves.toMatchObject({ status: 200 });
    });
  });
});
