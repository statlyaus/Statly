// @vitest-environment node
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  DraftType,
  LeagueRole,
  TradeActionType,
  TradeErrorCode,
  TradeStatus,
} from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

const DB_PATH = path.resolve(process.cwd(), 'trade_service_test.db');
const DATABASE_URL = `file:${DB_PATH}`;

let prisma: PrismaClient;
let tradeService: typeof import('../../src/services/tradeService').tradeService;

let prismaReady = true;
let prismaError: unknown = null;

try {
  if (fs.existsSync(DB_PATH)) {
    fs.rmSync(DB_PATH);
  }

  execSync('npx prisma db push --schema prisma/schema.prisma', {
    env: { ...process.env, DATABASE_URL },
    stdio: 'pipe',
  });
} catch (error) {
  prismaReady = false;
  prismaError = error;
  console.warn(
    'Skipping tradeService integration tests: Prisma engine failed to run db push on this machine.'
  );
  if (prismaError) {
    console.warn(String(prismaError));
  }
}

const suite = prismaReady ? describe : describe.skip;

suite('tradeService integration (sqlite)', () => {
  beforeAll(async () => {
    vi.setConfig({ testTimeout: 60000 });

    if (!prismaReady) {
      return;
    }

    process.env.DATABASE_URL = DATABASE_URL;
    delete (globalThis as { prisma?: PrismaClient }).prisma;

    const prismaModule = await import('../../src/lib/prisma');
    prisma = prismaModule.prisma;

    const serviceModule = await import('../../src/services/tradeService');
    tradeService = serviceModule.tradeService;
  });

  afterAll(async () => {
    if (!prismaReady) {
      return;
    }

    if (prisma) {
      await prisma.$disconnect();
    }
    if (fs.existsSync(DB_PATH)) {
      fs.rmSync(DB_PATH);
    }
  });

  beforeEach(async () => {
    if (!prismaReady) {
      return;
    }

    await prisma.tradeAction.deleteMany();
    await prisma.tradeAudit.deleteMany();
    await prisma.tradePlayerLock.deleteMany();
    await prisma.tradeItem.deleteMany();
    await prisma.trade.deleteMany();
    await prisma.leagueRosterPlayer.deleteMany();
    await prisma.leagueRoster.deleteMany();
    await prisma.leagueMember.deleteMany();
    await prisma.league.deleteMany();
    await prisma.leagueSettings.deleteMany();
    await prisma.player.deleteMany();
    await prisma.user.deleteMany();

    await prisma.user.createMany({
      data: [
        {
          id: 'user_1',
          email: 'user1@example.com',
          passwordHash: 'hash1',
          displayName: 'User One',
        },
        {
          id: 'user_2',
          email: 'user2@example.com',
          passwordHash: 'hash2',
          displayName: 'User Two',
        },
      ],
    });

    await prisma.leagueSettings.create({
      data: {
        id: 'settings_1',
        rosterSize: 1,
        benchSize: 0,
        maxTeams: 2,
        pickSeconds: 60,
        draftType: DraftType.SNAKE,
        startAt: new Date(),
        locked: false,
      },
    });

    await prisma.league.create({
      data: {
        id: 'league_1',
        name: 'Test League',
        inviteCode: 'INVITE1',
        ownerId: 'user_1',
        settingsId: 'settings_1',
      },
    });

    await prisma.leagueMember.createMany({
      data: [
        {
          id: 'member_1',
          leagueId: 'league_1',
          userId: 'user_1',
          role: LeagueRole.OWNER,
          teamName: 'Team One',
          draftSlot: 1,
        },
        {
          id: 'member_2',
          leagueId: 'league_1',
          userId: 'user_2',
          role: LeagueRole.MANAGER,
          teamName: 'Team Two',
          draftSlot: 2,
        },
      ],
    });

    await prisma.player.createMany({
      data: [
        { id: 'p1', name: 'Player One', club: 'Club A', position: 'MID' },
        { id: 'p2', name: 'Player Two', club: 'Club B', position: 'FWD' },
      ],
    });

    await prisma.leagueRosterPlayer.createMany({
      data: [
        { leagueId: 'league_1', memberId: 'member_1', playerId: 'p1' },
        { leagueId: 'league_1', memberId: 'member_2', playerId: 'p2' },
      ],
    });
  });

  it('propose -> accept executes trade and releases locks', async () => {
    if (!prismaReady) {
      return;
    }

    const proposed = await tradeService.proposeTrade({
      requestId: 'req_propose_1',
      leagueId: 'league_1',
      proposerUserId: 'user_1',
      recipientUserId: 'user_2',
      items: [
        { fromUserId: 'user_1', toUserId: 'user_2', playerId: 'p1' },
        { fromUserId: 'user_2', toUserId: 'user_1', playerId: 'p2' },
      ],
    });

    expect(proposed.status).toBe(TradeStatus.PROPOSED);

    const lockCount = await prisma.tradePlayerLock.count();
    expect(lockCount).toBe(2);

    const accepted = await tradeService.acceptTrade({
      requestId: 'req_accept_1',
      tradeId: proposed.tradeId,
      actorUserId: 'user_2',
    });

    expect(accepted.status).toBe(TradeStatus.EXECUTED);

    const locksAfter = await prisma.tradePlayerLock.count();
    expect(locksAfter).toBe(0);

    const trade = await prisma.trade.findUnique({ where: { id: proposed.tradeId } });
    expect(trade?.status).toBe(TradeStatus.EXECUTED);

    const member1Players = await prisma.leagueRosterPlayer.findMany({
      where: { leagueId: 'league_1', memberId: 'member_1' },
      select: { playerId: true },
    });
    const member2Players = await prisma.leagueRosterPlayer.findMany({
      where: { leagueId: 'league_1', memberId: 'member_2' },
      select: { playerId: true },
    });

    expect(member1Players.map((row) => row.playerId).sort()).toEqual(['p2']);
    expect(member2Players.map((row) => row.playerId).sort()).toEqual(['p1']);
  });

  it('accept is idempotent for the same requestId', async () => {
    if (!prismaReady) {
      return;
    }

    const proposed = await tradeService.proposeTrade({
      requestId: 'req_propose_2',
      leagueId: 'league_1',
      proposerUserId: 'user_1',
      recipientUserId: 'user_2',
      items: [
        { fromUserId: 'user_1', toUserId: 'user_2', playerId: 'p1' },
        { fromUserId: 'user_2', toUserId: 'user_1', playerId: 'p2' },
      ],
    });

    const accepted = await tradeService.acceptTrade({
      requestId: 'req_accept_2',
      tradeId: proposed.tradeId,
      actorUserId: 'user_2',
    });

    expect(accepted.status).toBe(TradeStatus.EXECUTED);

    const member1AfterFirst = await prisma.leagueRosterPlayer.findMany({
      where: { leagueId: 'league_1', memberId: 'member_1' },
      select: { playerId: true },
    });
    const member2AfterFirst = await prisma.leagueRosterPlayer.findMany({
      where: { leagueId: 'league_1', memberId: 'member_2' },
      select: { playerId: true },
    });

    const replay = await tradeService.acceptTrade({
      requestId: 'req_accept_2',
      tradeId: proposed.tradeId,
      actorUserId: 'user_2',
    });

    expect(replay.status).toBe(TradeStatus.EXECUTED);

    const actionCount = await prisma.tradeAction.count({
      where: { tradeId: proposed.tradeId, action: TradeActionType.ACCEPT },
    });
    expect(actionCount).toBe(1);

    const locksAfter = await prisma.tradePlayerLock.count();
    expect(locksAfter).toBe(0);

    const member1AfterReplay = await prisma.leagueRosterPlayer.findMany({
      where: { leagueId: 'league_1', memberId: 'member_1' },
      select: { playerId: true },
    });
    const member2AfterReplay = await prisma.leagueRosterPlayer.findMany({
      where: { leagueId: 'league_1', memberId: 'member_2' },
      select: { playerId: true },
    });

    expect(member1AfterReplay.map((row) => row.playerId).sort()).toEqual(
      member1AfterFirst.map((row) => row.playerId).sort()
    );
    expect(member2AfterReplay.map((row) => row.playerId).sort()).toEqual(
      member2AfterFirst.map((row) => row.playerId).sort()
    );
  });

  it('counter-offer transfers locks and supersedes parent', async () => {
    if (!prismaReady) {
      return;
    }

    const parent = await tradeService.proposeTrade({
      requestId: 'req_parent_1',
      leagueId: 'league_1',
      proposerUserId: 'user_1',
      recipientUserId: 'user_2',
      items: [
        { fromUserId: 'user_1', toUserId: 'user_2', playerId: 'p1' },
        { fromUserId: 'user_2', toUserId: 'user_1', playerId: 'p2' },
      ],
    });

    await expect(
      tradeService.proposeTrade({
        requestId: 'req_parent_forbidden',
        leagueId: 'league_1',
        proposerUserId: 'user_1',
        recipientUserId: 'user_2',
        parentTradeId: parent.tradeId,
        items: [
          { fromUserId: 'user_1', toUserId: 'user_2', playerId: 'p1' },
          { fromUserId: 'user_2', toUserId: 'user_1', playerId: 'p2' },
        ],
      })
    ).rejects.toMatchObject({ code: TradeErrorCode.TRADE_FORBIDDEN });

    const child = await tradeService.proposeTrade({
      requestId: 'req_child_1',
      leagueId: 'league_1',
      proposerUserId: 'user_2',
      recipientUserId: 'user_1',
      parentTradeId: parent.tradeId,
      items: [
        { fromUserId: 'user_1', toUserId: 'user_2', playerId: 'p1' },
        { fromUserId: 'user_2', toUserId: 'user_1', playerId: 'p2' },
      ],
    });

    const parentTrade = await prisma.trade.findUnique({
      where: { id: parent.tradeId },
    });
    const childTrade = await prisma.trade.findUnique({
      where: { id: child.tradeId },
    });

    expect(parentTrade?.status).toBe(TradeStatus.SUPERSEDED);
    expect(parentTrade?.supersededByTradeId).toBe(child.tradeId);
    expect(childTrade?.status).toBe(TradeStatus.PROPOSED);

    const locks = await prisma.tradePlayerLock.findMany({
      where: { playerId: { in: ['p1', 'p2'] } },
      select: { playerId: true, tradeId: true },
    });

    expect(locks).toHaveLength(2);
    expect(locks.map((lock) => lock.tradeId)).toEqual([
      child.tradeId,
      child.tradeId,
    ]);
  });
});
