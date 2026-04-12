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
const SQLITE_SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "displayName" TEXT NOT NULL,
  "timeZone" TEXT NOT NULL DEFAULT 'UTC',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "UserCredential" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "passwordHash" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "LeagueSettings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "rosterSize" INTEGER NOT NULL,
  "benchSize" INTEGER NOT NULL,
  "maxTeams" INTEGER NOT NULL,
  "pickSeconds" INTEGER NOT NULL,
  "allowAutoPick" BOOLEAN NOT NULL DEFAULT 1,
  "enableDraftReminders" BOOLEAN NOT NULL DEFAULT 1,
  "draftType" TEXT NOT NULL,
  "startAt" DATETIME NOT NULL,
  "timeZone" TEXT NOT NULL DEFAULT 'UTC',
  "locked" BOOLEAN NOT NULL DEFAULT 0,
  "seasonWeeks" INTEGER NOT NULL DEFAULT 12,
  "matchupsPerOpponent" INTEGER NOT NULL DEFAULT 1,
  "playoffsEnabled" BOOLEAN NOT NULL DEFAULT 0,
  "playoffTeams" INTEGER NOT NULL DEFAULT 0,
  "playoffLegLengthWeeks" INTEGER NOT NULL DEFAULT 1,
  "playoffReseedEachRound" BOOLEAN NOT NULL DEFAULT 0,
  "playoffIncludeConsolation" BOOLEAN NOT NULL DEFAULT 0,
  "enableCaptainSystem" BOOLEAN NOT NULL DEFAULT 0,
  "captainMultiplier" REAL NOT NULL DEFAULT 2.0,
  "viceCaptainMultiplier" REAL NOT NULL DEFAULT 1.5
);

CREATE TABLE "League" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "inviteCode" TEXT NOT NULL UNIQUE,
  "type" TEXT NOT NULL DEFAULT 'private',
  "ownerId" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'preseason',
  "categoriesJson" TEXT,
  "draftDate" DATETIME,
  "tradeLimit" INTEGER NOT NULL DEFAULT 10,
  "tradeReview" TEXT NOT NULL DEFAULT 'none',
  "tradeVetoPeriodHours" INTEGER NOT NULL DEFAULT 24,
  "tradeDeadline" DATETIME,
  "waiverOrderJson" TEXT,
  "waiverPeriodHours" INTEGER NOT NULL DEFAULT 24,
  "waiverResetPolicy" TEXT NOT NULL DEFAULT 'weekly',
  "waiverSystem" TEXT NOT NULL DEFAULT 'ROLLING_LIST',
  "waiverPriorityMode" TEXT NOT NULL DEFAULT 'ROLLING',
  "waiverFaabBudget" INTEGER,
  "waiverMinimumBid" INTEGER NOT NULL DEFAULT 1,
  "waiverMaxWeekAcquisitions" INTEGER,
  "waiverMaxSeasonAcquisitions" INTEGER,
  "waiverMoveWinnerToBack" BOOLEAN NOT NULL DEFAULT 1,
  "waiverAcquisitionLocked" BOOLEAN NOT NULL DEFAULT 0,
  "cantDropListJson" TEXT,
  "settingsId" TEXT NOT NULL UNIQUE,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "League_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "League_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "LeagueSettings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "LeagueMember" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "leagueId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "teamName" TEXT NOT NULL,
  "draftSlot" INTEGER,
  "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeagueMember_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LeagueMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "LeagueMember_leagueId_idx" ON "LeagueMember"("leagueId");
CREATE INDEX "LeagueMember_userId_idx" ON "LeagueMember"("userId");
CREATE UNIQUE INDEX "LeagueMember_leagueId_userId_key" ON "LeagueMember"("leagueId", "userId");

CREATE TABLE "Player" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "club" TEXT NOT NULL,
  "position" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT 1
);

CREATE TABLE "LeagueRoster" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "leagueId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "captainId" TEXT,
  "viceCaptainId" TEXT,
  "benchOrder" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeagueRoster_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeagueRoster_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeagueRoster_captainId_fkey" FOREIGN KEY ("captainId") REFERENCES "Player" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "LeagueRoster_viceCaptainId_fkey" FOREIGN KEY ("viceCaptainId") REFERENCES "Player" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LeagueRoster_leagueId_memberId_key" ON "LeagueRoster"("leagueId", "memberId");

CREATE TABLE "LeagueRosterPlayer" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "leagueId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeagueRosterPlayer_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeagueRosterPlayer_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeagueRosterPlayer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LeagueRosterPlayer_leagueId_memberId_playerId_key" ON "LeagueRosterPlayer"("leagueId", "memberId", "playerId");

CREATE TABLE "Trade" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "leagueId" TEXT NOT NULL,
  "roundId" TEXT,
  "proposerUserId" TEXT NOT NULL,
  "recipientUserId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "requestPayloadHash" TEXT NOT NULL,
  "parentTradeId" TEXT,
  "supersededByTradeId" TEXT,
  "note" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt" DATETIME,
  "executedAt" DATETIME,
  "reviewMode" TEXT NOT NULL DEFAULT 'NONE',
  "reviewStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
  "reviewRequestedAt" DATETIME,
  "reviewWindowEndsAt" DATETIME,
  "reviewDecidedAt" DATETIME,
  "proposerViewedAt" DATETIME,
  "recipientViewedAt" DATETIME,
  CONSTRAINT "Trade_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Trade_proposerUserId_fkey" FOREIGN KEY ("proposerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Trade_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Trade_requestId_proposerUserId_key" ON "Trade"("requestId", "proposerUserId");
CREATE UNIQUE INDEX "Trade_parentTradeId_key" ON "Trade"("parentTradeId");
CREATE UNIQUE INDEX "Trade_supersededByTradeId_key" ON "Trade"("supersededByTradeId");

CREATE TABLE "TradeItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tradeId" TEXT NOT NULL,
  "fromUserId" TEXT NOT NULL,
  "toUserId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeItem_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TradeItem_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TradeItem_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TradeItem_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TradeItem_tradeId_playerId_key" ON "TradeItem"("tradeId", "playerId");

CREATE TABLE "TradePlayerLock" (
  "leagueId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "tradeId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradePlayerLock_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TradePlayerLock_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY ("leagueId", "playerId")
);
CREATE INDEX "TradePlayerLock_tradeId_idx" ON "TradePlayerLock"("tradeId");

CREATE TABLE "TradeAudit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tradeId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "payloadJson" JSON NOT NULL,
  "errorCode" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeAudit_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TradeAudit_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "TradeReviewVote" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tradeId" TEXT NOT NULL,
  "voterUserId" TEXT NOT NULL,
  "voteType" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeReviewVote_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TradeReviewVote_voterUserId_fkey" FOREIGN KEY ("voterUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TradeReviewVote_tradeId_voterUserId_key" ON "TradeReviewVote"("tradeId", "voterUserId");

CREATE TABLE "TradeAction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tradeId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeAction_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TradeAction_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TradeAction_requestId_key" ON "TradeAction"("requestId");
CREATE UNIQUE INDEX "TradeAction_tradeId_action_key" ON "TradeAction"("tradeId", "action");
`;

let prisma: PrismaClient;
let tradeService: typeof import('../../src/services/tradeService').tradeService;

let prismaReady = true;
let prismaError: unknown = null;

try {
  if (fs.existsSync(DB_PATH)) {
    fs.rmSync(DB_PATH);
  }

  execSync(`sqlite3 "${DB_PATH}"`, {
    input: SQLITE_SCHEMA,
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
    await prisma.userCredential.deleteMany();
    await prisma.user.deleteMany();

    await prisma.user.createMany({
      data: [
        { id: 'user_1', email: 'user1@example.com', displayName: 'User One' },
        { id: 'user_2', email: 'user2@example.com', displayName: 'User Two' },
        { id: 'user_3', email: 'user3@example.com', displayName: 'User Three' },
        { id: 'user_4', email: 'user4@example.com', displayName: 'User Four' },
      ],
    });

    await prisma.userCredential.createMany({
      data: [
        { userId: 'user_1', passwordHash: 'hash1' },
        { userId: 'user_2', passwordHash: 'hash2' },
        { userId: 'user_3', passwordHash: 'hash3' },
        { userId: 'user_4', passwordHash: 'hash4' },
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

    await prisma.leagueRoster.createMany({
      data: [
        {
          id: 'roster_1',
          leagueId: 'league_1',
          memberId: 'member_1',
          captainId: 'p1',
          viceCaptainId: 'p1',
          benchOrder: JSON.stringify(['p1']),
        },
        {
          id: 'roster_2',
          leagueId: 'league_1',
          memberId: 'member_2',
          captainId: 'p2',
          viceCaptainId: 'p2',
          benchOrder: JSON.stringify(['p2']),
        },
      ],
    });
  });

  it('rejects self-trade proposal', async () => {
    if (!prismaReady) {
      return;
    }

    await expect(
      tradeService.proposeTrade({
        requestId: 'req_self_trade',
        leagueId: 'league_1',
        proposerUserId: 'user_1',
        recipientUserId: 'user_1',
        items: [{ fromUserId: 'user_1', toUserId: 'user_2', playerId: 'p1' }],
      })
    ).rejects.toEqual(expect.objectContaining({ code: TradeErrorCode.TRADE_INVALID_PAYLOAD }));
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
    const roster1 = await prisma.leagueRoster.findUnique({
      where: { leagueId_memberId: { leagueId: 'league_1', memberId: 'member_1' } },
    });
    const roster2 = await prisma.leagueRoster.findUnique({
      where: { leagueId_memberId: { leagueId: 'league_1', memberId: 'member_2' } },
    });
    const ownershipRows = await prisma.leagueRosterPlayer.findMany({
      where: { leagueId: 'league_1' },
      select: { playerId: true, memberId: true },
    });

    expect(member1Players.map((row) => row.playerId).sort()).toEqual(['p2']);
    expect(member2Players.map((row) => row.playerId).sort()).toEqual(['p1']);
    expect(roster1?.captainId).toBeNull();
    expect(roster1?.viceCaptainId).toBeNull();
    expect(roster1?.benchOrder).toBeNull();
    expect(roster2?.captainId).toBeNull();
    expect(roster2?.viceCaptainId).toBeNull();
    expect(roster2?.benchOrder).toBeNull();
    expect(ownershipRows.map((row) => `${row.playerId}:${row.memberId}`).sort()).toEqual([
      'p1:member_2',
      'p2:member_1',
    ]);
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
    expect(locks.map((lock) => lock.tradeId)).toEqual([child.tradeId, child.tradeId]);
  });

  it('rejects invalid one-sided trade payloads before persisting', async () => {
    if (!prismaReady) {
      return;
    }

    await expect(
      tradeService.proposeTrade({
        requestId: 'req_invalid_payload_1',
        leagueId: 'league_1',
        proposerUserId: 'user_1',
        recipientUserId: 'user_2',
        items: [{ fromUserId: 'user_1', toUserId: 'user_2', playerId: 'p1' }],
      })
    ).rejects.toMatchObject({ code: TradeErrorCode.TRADE_INVALID_PAYLOAD });

    expect(await prisma.trade.count()).toBe(0);
  });

  it('holds accepted trades in review when commissioner approval is required', async () => {
    if (!prismaReady) {
      return;
    }

    await prisma.league.update({
      where: { id: 'league_1' },
      data: { tradeReview: 'admin' },
    });

    const proposed = await tradeService.proposeTrade({
      requestId: 'req_review_propose_1',
      leagueId: 'league_1',
      proposerUserId: 'user_1',
      recipientUserId: 'user_2',
      items: [
        { fromUserId: 'user_1', toUserId: 'user_2', playerId: 'p1' },
        { fromUserId: 'user_2', toUserId: 'user_1', playerId: 'p2' },
      ],
    });

    const accepted = await tradeService.acceptTrade({
      requestId: 'req_review_accept_1',
      tradeId: proposed.tradeId,
      actorUserId: 'user_2',
    });

    expect(accepted.status).toBe(TradeStatus.REVIEW_PENDING);
    expect(accepted.reviewStatus).toBe('PENDING');
    expect(await prisma.tradePlayerLock.count()).toBe(2);

    const approved = await tradeService.approveTradeReview({
      requestId: 'req_review_approve_1',
      tradeId: proposed.tradeId,
      actorUserId: 'user_1',
    });

    expect(approved.status).toBe(TradeStatus.EXECUTED);
    expect(approved.reviewStatus).toBe('APPROVED');
    expect(await prisma.tradePlayerLock.count()).toBe(0);
  });

  it('scopes player locks by league so the same player ids can trade concurrently elsewhere', async () => {
    if (!prismaReady) {
      return;
    }

    await prisma.leagueSettings.create({
      data: {
        id: 'settings_2',
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
        id: 'league_2',
        name: 'Second League',
        inviteCode: 'INVITE2',
        ownerId: 'user_3',
        settingsId: 'settings_2',
      },
    });

    await prisma.leagueMember.createMany({
      data: [
        {
          id: 'member_3',
          leagueId: 'league_2',
          userId: 'user_3',
          role: LeagueRole.OWNER,
          teamName: 'Team Three',
          draftSlot: 1,
        },
        {
          id: 'member_4',
          leagueId: 'league_2',
          userId: 'user_4',
          role: LeagueRole.MANAGER,
          teamName: 'Team Four',
          draftSlot: 2,
        },
      ],
    });

    await prisma.leagueRosterPlayer.createMany({
      data: [
        { leagueId: 'league_2', memberId: 'member_3', playerId: 'p1' },
        { leagueId: 'league_2', memberId: 'member_4', playerId: 'p2' },
      ],
    });

    const firstTrade = await tradeService.proposeTrade({
      requestId: 'req_league_one_trade',
      leagueId: 'league_1',
      proposerUserId: 'user_1',
      recipientUserId: 'user_2',
      items: [
        { fromUserId: 'user_1', toUserId: 'user_2', playerId: 'p1' },
        { fromUserId: 'user_2', toUserId: 'user_1', playerId: 'p2' },
      ],
    });

    const secondTrade = await tradeService.proposeTrade({
      requestId: 'req_league_two_trade',
      leagueId: 'league_2',
      proposerUserId: 'user_3',
      recipientUserId: 'user_4',
      items: [
        { fromUserId: 'user_3', toUserId: 'user_4', playerId: 'p1' },
        { fromUserId: 'user_4', toUserId: 'user_3', playerId: 'p2' },
      ],
    });

    expect(firstTrade.status).toBe(TradeStatus.PROPOSED);
    expect(secondTrade.status).toBe(TradeStatus.PROPOSED);

    const locks = await prisma.tradePlayerLock.findMany({
      orderBy: [{ leagueId: 'asc' }, { playerId: 'asc' }],
      select: { leagueId: true, playerId: true, tradeId: true },
    });

    expect(locks).toEqual([
      { leagueId: 'league_1', playerId: 'p1', tradeId: firstTrade.tradeId },
      { leagueId: 'league_1', playerId: 'p2', tradeId: firstTrade.tradeId },
      { leagueId: 'league_2', playerId: 'p1', tradeId: secondTrade.tradeId },
      { leagueId: 'league_2', playerId: 'p2', tradeId: secondTrade.tradeId },
    ]);
  });
});
