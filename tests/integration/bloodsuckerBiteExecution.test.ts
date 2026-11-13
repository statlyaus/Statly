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

import type { LeagueBite } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import {
  BiteError,
  commissionerBiteAction,
  executeBite,
  isBloodsuckerRoundSelfOverride,
} from '@/server/leagues/bloodsuckerBites';
import { swapRosterPlayers } from '@/server/leagues/rosterSwap';
import { createLeagueTrade } from '@/server/leagues/trades/tradeService';

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
const PLAYERS = ['v1', 'v2', 'b1', 'b2', 'o1'].map((key) => `${P}-${key}`);
const [V1, V2, B1, B2, O1] = PLAYERS as [string, string, string, string, string];
const HOUR = 60 * 60 * 1000;
const NOW = new Date();

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
    data: PLAYERS.map((id) => ({ id, name: id, club: 'GWS', position: 'MID' })),
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
});
