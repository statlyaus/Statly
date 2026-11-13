/**
 * Bloodsucker 8/9 (#1285): the Bloodsucker cannot trade (BR-31) and a bitten player cannot be
 * traded back to the team he was bitten from this season (BR-32). Runs every trade path against
 * PostgreSQL: propose, counter, accept, commissioner approval and the veto-review cron.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/server/waivers/WaiverAvailabilityProjectionService', () => ({
  WaiverAvailabilityProjectionService: class {
    projectLeague = vi.fn().mockResolvedValue({ owned: 0, available: 0 });
  },
}));

import type { TradeReviewMode } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import {
  createLeagueTrade,
  executeLeagueTradeAction,
  processDueLeagueTrades,
} from '@/server/leagues/trades/tradeService';

import { deleteLeagueFixtures } from './helpers/deleteLeagueFixtures';

const P = 'int-bs-trades';
const LEAGUE = `${P}-league`;
const SETTINGS = `${P}-settings`;
const SEASON = `${P}-2026`;
const OLD_SEASON = `${P}-2025`;
const USERS = {
  owner: `${P}-u-owner`,
  bs: `${P}-u-bs`,
  victim: `${P}-u-victim`,
  third: `${P}-u-third`,
};
const OWNER = `${P}-owner`;
const BS = `${P}-bs`;
const VICTIM = `${P}-victim`;
const THIRD = `${P}-third`;
// BITTEN was taken from the victim in a bite and now sits with the third team.
const PLAYERS = ['v1', 'b1', 'bitten', 't1', 'o1'].map((key) => `${P}-${key}`);
const [V1, B1, BITTEN, T1, O1] = PLAYERS as [string, string, string, string, string];
const HOUR = 60 * 60 * 1000;
const NOW = new Date();

let keySeq = 0;
const key = () => `${P}-key-${++keySeq}`.padEnd(16, '0');

const removeFixture = () =>
  deleteLeagueFixtures(prisma, {
    leagueIds: [LEAGUE],
    playerIds: PLAYERS,
    settingsIds: [SETTINGS],
    userIds: Object.values(USERS),
  });

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
      rosterSize: 4,
      benchSize: 0,
      maxTeams: 8,
      pickSeconds: 60,
      draftType: 'SNAKE',
      waiverRule: 'ROLLING',
      leagueFormat: 'BLOODSUCKER',
      tradeReviewMode: 'NONE',
      tradeOfferExpiryHours: 72,
      tradeReviewHours: 24,
    },
  });
  await prisma.league.create({
    data: {
      id: LEAGUE,
      name: 'Bloodsucker trades',
      inviteCode: 'INTBSTRD',
      ownerId: USERS.owner,
      settingsId: SETTINGS,
    },
  });
  await prisma.leagueSeason.createMany({
    data: [
      { id: OLD_SEASON, leagueId: LEAGUE, label: '2025 season', year: 2025 },
      { id: SEASON, leagueId: LEAGUE, label: '2026 season', year: 2026 },
    ],
  });
  await prisma.league.update({ where: { id: LEAGUE }, data: { activeSeasonId: SEASON } });
  await prisma.leagueMember.createMany({
    data: [
      { id: OWNER, leagueId: LEAGUE, userId: USERS.owner, role: 'OWNER', teamName: 'Owners' },
      { id: BS, leagueId: LEAGUE, userId: USERS.bs, role: 'MANAGER', teamName: 'Suckers' },
      { id: VICTIM, leagueId: LEAGUE, userId: USERS.victim, role: 'MANAGER', teamName: 'Victims' },
      { id: THIRD, leagueId: LEAGUE, userId: USERS.third, role: 'MANAGER', teamName: 'Thirds' },
    ],
  });
  await prisma.leagueSettings.update({
    where: { id: SETTINGS },
    data: { bloodsuckerMemberId: BS },
  });
  // The draft and the Bloodsucker's free-agency window are long over.
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
      { leagueId: LEAGUE, memberId: BS, playerId: B1 },
      { leagueId: LEAGUE, memberId: THIRD, playerId: BITTEN },
      { leagueId: LEAGUE, memberId: THIRD, playerId: T1 },
      { leagueId: LEAGUE, memberId: OWNER, playerId: O1 },
    ],
  });
}

function recordBite(input: {
  status: 'EXECUTED' | 'AUTO_EXECUTED' | 'CANCELLED' | 'OPEN';
  seasonId?: string;
  matchupId?: string;
}) {
  return prisma.leagueBite.create({
    data: {
      leagueId: LEAGUE,
      seasonId: input.seasonId ?? SEASON,
      roundId: `${P}-round-1`,
      round: 1,
      matchupId: input.matchupId ?? `${P}-matchup-1`,
      bloodsuckerMemberId: BS,
      victimMemberId: VICTIM,
      grantedWinnerMemberId: BS,
      status: input.status,
      opensAt: new Date(NOW.getTime() - 48 * HOUR),
      deadlineAt: new Date(NOW.getTime() - 24 * HOUR),
      takenPlayerId: BITTEN,
      returnedPlayerId: B1,
      executedAt: input.status === 'OPEN' ? null : new Date(NOW.getTime() - 40 * HOUR),
    },
  });
}

const setFormat = (leagueFormat: 'BLOODSUCKER' | 'STANDARD') =>
  prisma.leagueSettings.update({ where: { id: SETTINGS }, data: { leagueFormat } });
const setReviewMode = (tradeReviewMode: TradeReviewMode) =>
  prisma.leagueSettings.update({ where: { id: SETTINGS }, data: { tradeReviewMode } });

const propose = (
  userId: string,
  recipientMemberId: string,
  sendingPlayerIds: string[],
  receivingPlayerIds: string[]
) =>
  createLeagueTrade(
    LEAGUE,
    userId,
    { recipientMemberId, sendingPlayerIds, receivingPlayerIds, idempotencyKey: key() },
    NOW
  );

const act = (
  userId: string,
  thread: { threadId: string; version: number },
  action: Record<string, unknown>,
  now = NOW
) =>
  executeLeagueTradeAction(
    LEAGUE,
    userId,
    thread.threadId,
    { ...action, expectedVersion: thread.version, idempotencyKey: key() },
    now
  );

const ownerOf = async (playerId: string) =>
  (await prisma.leagueRosterPlayer.findFirst({ where: { leagueId: LEAGUE, playerId } }))?.memberId;
const threadCount = () => prisma.leagueTradeThread.count({ where: { leagueId: LEAGUE } });

describe.sequential('Bloodsucker trade rules (#1285)', () => {
  beforeEach(async () => {
    await seed();
  });

  afterAll(async () => {
    await removeFixture();
  });

  describe('BR-31: the Bloodsucker cannot trade', () => {
    it('refuses a proposal from the Bloodsucker', async () => {
      await expect(propose(USERS.bs, THIRD, [B1], [T1])).rejects.toMatchObject({
        code: 'BLOODSUCKER_CANNOT_TRADE',
        status: 409,
      });
      expect(await threadCount()).toBe(0);
    });

    it('refuses a proposal sent to the Bloodsucker', async () => {
      await expect(propose(USERS.third, BS, [T1], [B1])).rejects.toMatchObject({
        code: 'BLOODSUCKER_CANNOT_TRADE',
        status: 409,
      });
      expect(await threadCount()).toBe(0);
    });

    // An offer that reached the Bloodsucker some other way (here: made while the league was still
    // STANDARD) is refused at every later step and never completes.
    async function legacyOfferToBloodsucker() {
      await setFormat('STANDARD');
      const offer = await propose(USERS.third, BS, [T1], [B1]);
      await setFormat('BLOODSUCKER');
      return offer;
    }

    it('refuses acceptance and counters on an offer that includes the Bloodsucker', async () => {
      const offer = await legacyOfferToBloodsucker();

      await expect(act(USERS.bs, offer, { action: 'accept' })).rejects.toMatchObject({
        code: 'BLOODSUCKER_CANNOT_TRADE',
      });
      await expect(
        act(USERS.bs, offer, {
          action: 'counter',
          sendingPlayerIds: [B1],
          receivingPlayerIds: [T1],
        })
      ).rejects.toMatchObject({ code: 'BLOODSUCKER_CANNOT_TRADE' });
      expect(await ownerOf(B1)).toBe(BS);
      expect(await ownerOf(T1)).toBe(THIRD);
    });

    it('refuses commissioner approval of a trade that includes the Bloodsucker', async () => {
      await setReviewMode('ADMIN');
      await setFormat('STANDARD');
      const offer = await propose(USERS.third, BS, [T1], [B1]);
      const accepted = await act(USERS.bs, offer, { action: 'accept' });
      expect(accepted.status).toBe('PENDING_ADMIN_REVIEW');
      await setFormat('BLOODSUCKER');

      await expect(act(USERS.owner, accepted, { action: 'approve' })).rejects.toMatchObject({
        code: 'BLOODSUCKER_CANNOT_TRADE',
      });
      expect(await ownerOf(B1)).toBe(BS);
    });

    it('invalidates a veto-review trade with the Bloodsucker when its review ends', async () => {
      await setReviewMode('VETO');
      await setFormat('STANDARD');
      const offer = await propose(USERS.third, BS, [T1], [B1]);
      const accepted = await act(USERS.bs, offer, { action: 'accept' });
      expect(accepted.status).toBe('PENDING_VETO_REVIEW');
      await setFormat('BLOODSUCKER');

      await processDueLeagueTrades(new Date(NOW.getTime() + 25 * HOUR));

      const thread = await prisma.leagueTradeThread.findUniqueOrThrow({
        where: { id: accepted.threadId },
        select: { status: true, events: { select: { reasonCode: true } } },
      });
      expect(thread.status).toBe('INVALIDATED');
      expect(thread.events.map((event) => event.reasonCode)).toContain('BLOODSUCKER_CANNOT_TRADE');
      expect(await ownerOf(B1)).toBe(BS);
    });

    it('leaves trades between other teams alone', async () => {
      const offer = await propose(USERS.third, OWNER, [T1], [O1]);
      const done = await act(USERS.owner, offer, { action: 'accept' });
      expect(done.status).toBe('COMPLETED');
      expect(await ownerOf(T1)).toBe(OWNER);
    });
  });

  describe('BR-32: a bitten player cannot be traded back', () => {
    it('refuses a trade that sends the bitten player back to his old team', async () => {
      await recordBite({ status: 'EXECUTED' });

      await expect(propose(USERS.third, VICTIM, [BITTEN], [V1])).rejects.toMatchObject({
        code: 'BITTEN_PLAYER_TRADE_BACK',
        status: 409,
      });
      // The victim cannot ask for him back either.
      await expect(propose(USERS.victim, THIRD, [V1], [BITTEN])).rejects.toMatchObject({
        code: 'BITTEN_PLAYER_TRADE_BACK',
      });
      expect(await threadCount()).toBe(0);
    });

    it('allows the bitten player to be traded to a third team', async () => {
      await recordBite({ status: 'AUTO_EXECUTED' });

      const offer = await propose(USERS.third, OWNER, [BITTEN], [O1]);
      const done = await act(USERS.owner, offer, { action: 'accept' });
      expect(done.status).toBe('COMPLETED');
      expect(await ownerOf(BITTEN)).toBe(OWNER);
    });

    it('refuses a counter that sends the bitten player back', async () => {
      await recordBite({ status: 'EXECUTED' });
      const offer = await propose(USERS.victim, THIRD, [V1], [T1]);

      await expect(
        act(USERS.third, offer, {
          action: 'counter',
          sendingPlayerIds: [BITTEN],
          receivingPlayerIds: [V1],
        })
      ).rejects.toMatchObject({ code: 'BITTEN_PLAYER_TRADE_BACK' });
    });

    it('refuses acceptance of a trade-back offered before the bite was recorded', async () => {
      const offer = await propose(USERS.third, VICTIM, [BITTEN], [V1]);
      await recordBite({ status: 'EXECUTED' });

      await expect(act(USERS.victim, offer, { action: 'accept' })).rejects.toMatchObject({
        code: 'BITTEN_PLAYER_TRADE_BACK',
      });
      expect(await ownerOf(BITTEN)).toBe(THIRD);
    });

    it('ignores bites that were not executed or belong to an earlier season', async () => {
      await recordBite({ status: 'CANCELLED' });
      await recordBite({ status: 'EXECUTED', seasonId: OLD_SEASON, matchupId: `${P}-matchup-old` });

      const offer = await propose(USERS.third, VICTIM, [BITTEN], [V1]);
      expect(offer.status).toBe('OPEN');
    });
  });

  it('leaves a STANDARD league unchanged', async () => {
    await setFormat('STANDARD');
    await recordBite({ status: 'EXECUTED' });

    const withFormerBloodsucker = await propose(USERS.bs, THIRD, [B1], [T1]);
    expect(withFormerBloodsucker.status).toBe('OPEN');
    const tradeBack = await propose(USERS.third, VICTIM, [BITTEN], [V1]);
    expect(tradeBack.status).toBe('OPEN');
  });
});
