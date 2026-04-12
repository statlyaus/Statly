// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { BotPersonality, LeagueRole, TradeStatus } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

const DB_PATH = path.resolve(process.cwd(), 'bot_manager_service_test.db');
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

CREATE TABLE "LeagueBotProfile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "leagueId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "personality" TEXT NOT NULL DEFAULT 'BALANCED',
  "enabled" BOOLEAN NOT NULL DEFAULT 1,
  "allowTradeInitiation" BOOLEAN NOT NULL DEFAULT 1,
  "allowTradeResponses" BOOLEAN NOT NULL DEFAULT 1,
  "allowWaiverClaims" BOOLEAN NOT NULL DEFAULT 1,
  "activityLevel" INTEGER NOT NULL DEFAULT 50,
  "tradeAggression" INTEGER NOT NULL DEFAULT 50,
  "tradeRiskTolerance" INTEGER NOT NULL DEFAULT 50,
  "waiverAggression" INTEGER NOT NULL DEFAULT 50,
  "preferredTradeCount" INTEGER NOT NULL DEFAULT 1,
  "minimumActionIntervalMins" INTEGER NOT NULL DEFAULT 180,
  "lastAutomatedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeagueBotProfile_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeagueBotProfile_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LeagueBotProfile_memberId_key" ON "LeagueBotProfile"("memberId");
CREATE UNIQUE INDEX "LeagueBotProfile_leagueId_memberId_key" ON "LeagueBotProfile"("leagueId", "memberId");

CREATE TABLE "Player" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "club" TEXT NOT NULL,
  "position" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT 1
);

CREATE TABLE "PlayerSeasonSummary" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "playerId" TEXT NOT NULL,
  "season" INTEGER NOT NULL,
  "playerName" TEXT NOT NULL,
  "club" TEXT NOT NULL,
  "position" TEXT NOT NULL,
  "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
  "averageScore" REAL NOT NULL DEFAULT 0,
  "totalValue" REAL NOT NULL DEFAULT 0,
  "statsJson" TEXT NOT NULL,
  "totalsJson" TEXT NOT NULL,
  "sourceUpdatedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlayerSeasonSummary_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PlayerSeasonSummary_playerId_season_key" ON "PlayerSeasonSummary"("playerId", "season");

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

CREATE TABLE "WaiverClaim" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "leagueId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "dropPlayerId" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 1,
  "bidAmount" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reason" TEXT,
  "processingAt" DATETIME,
  "processedAt" DATETIME,
  "cancelledByUserId" TEXT,
  "cancelledAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaiverClaim_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WaiverClaim_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WaiverClaim_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
`;

const acceptTradeMock = vi.fn();
const declineTradeMock = vi.fn();
const proposeTradeMock = vi.fn();
const submitWaiverClaimMock = vi.fn();

vi.mock('../../src/services/tradeService', () => ({
  tradeService: {
    acceptTrade: acceptTradeMock,
    declineTrade: declineTradeMock,
    proposeTrade: proposeTradeMock,
  },
}));

vi.mock('../../src/server/league/services/LeagueApplicationService', () => ({
  leagueApplicationService: {
    submitWaiverClaim: submitWaiverClaimMock,
  },
}));

let prisma: PrismaClient;
let botManagerService: typeof import('../../src/services/botManagerService').botManagerService;

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
}

const suite = prismaReady ? describe : describe.skip;

suite('botManagerService integration (sqlite)', () => {
  beforeAll(async () => {
    vi.setConfig({ testTimeout: 60000 });
    process.env.DATABASE_URL = DATABASE_URL;
    delete (globalThis as { prisma?: PrismaClient }).prisma;

    const prismaModule = await import('../../src/lib/prisma');
    prisma = prismaModule.prisma;

    const serviceModule = await import('../../src/services/botManagerService');
    botManagerService = serviceModule.botManagerService;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
    if (fs.existsSync(DB_PATH)) {
      fs.rmSync(DB_PATH);
    }
  });

  beforeEach(async () => {
    acceptTradeMock.mockReset();
    declineTradeMock.mockReset();
    proposeTradeMock.mockReset();
    submitWaiverClaimMock.mockReset();

    await prisma.tradeItem.deleteMany();
    await prisma.trade.deleteMany();
    await prisma.waiverClaim.deleteMany();
    await prisma.leagueRosterPlayer.deleteMany();
    await prisma.playerSeasonSummary.deleteMany();
    await prisma.player.deleteMany();
    await prisma.leagueBotProfile.deleteMany();
    await prisma.leagueMember.deleteMany();
    await prisma.league.deleteMany();
    await prisma.leagueSettings.deleteMany();
    await prisma.userCredential.deleteMany();
    await prisma.user.deleteMany();

    await prisma.user.createMany({
      data: [
        { id: 'owner_1', email: 'owner@example.com', displayName: 'Owner' },
        { id: 'bot_user_1', email: 'bot1@example.com', displayName: 'Bot One' },
        { id: 'human_1', email: 'human@example.com', displayName: 'Human' },
      ],
    });

    await prisma.userCredential.createMany({
      data: [
        { userId: 'owner_1', passwordHash: 'hash' },
        { userId: 'bot_user_1', passwordHash: 'hash' },
        { userId: 'human_1', passwordHash: 'hash' },
      ],
    });

    await prisma.leagueSettings.create({
      data: {
        id: 'settings_1',
        rosterSize: 1,
        benchSize: 0,
        maxTeams: 3,
        pickSeconds: 60,
        allowAutoPick: true,
        enableDraftReminders: false,
        draftType: 'SNAKE',
        startAt: new Date('2026-03-01T00:00:00.000Z'),
        timeZone: 'Australia/Melbourne',
        locked: false,
      },
    });

    await prisma.league.create({
      data: {
        id: 'league_1',
        name: 'Bot League',
        inviteCode: 'BOT12345',
        ownerId: 'owner_1',
        settingsId: 'settings_1',
      },
    });

    await prisma.leagueMember.createMany({
      data: [
        {
          id: 'member_owner',
          leagueId: 'league_1',
          userId: 'owner_1',
          role: LeagueRole.OWNER,
          teamName: 'Owner Team',
          draftSlot: 1,
        },
        {
          id: 'member_bot',
          leagueId: 'league_1',
          userId: 'bot_user_1',
          role: LeagueRole.MANAGER,
          teamName: 'Bot Team',
          draftSlot: 2,
        },
        {
          id: 'member_human',
          leagueId: 'league_1',
          userId: 'human_1',
          role: LeagueRole.MANAGER,
          teamName: 'Human Team',
          draftSlot: 3,
        },
      ],
    });
  });

  it('accepts a favorable pending trade for a bot recipient', async () => {
    await prisma.leagueBotProfile.create({
      data: {
        id: 'profile_1',
        leagueId: 'league_1',
        memberId: 'member_bot',
        personality: BotPersonality.BALANCED,
        allowTradeInitiation: false,
        allowTradeResponses: true,
        allowWaiverClaims: false,
        activityLevel: 100,
        tradeRiskTolerance: 50,
        minimumActionIntervalMins: 5,
      },
    });

    await prisma.player.createMany({
      data: [
        { id: 'player_bot', name: 'Bot Player', club: 'AAA', position: 'MID' },
        { id: 'player_human', name: 'Human Player', club: 'BBB', position: 'MID' },
      ],
    });

    await prisma.playerSeasonSummary.createMany({
      data: [
        {
          id: 'summary_bot',
          playerId: 'player_bot',
          season: 2026,
          playerName: 'Bot Player',
          club: 'AAA',
          position: 'MID',
          averageScore: 70,
          totalValue: 70,
          statsJson: '{}',
          totalsJson: '{}',
          sourceUpdatedAt: new Date('2026-03-01T00:00:00.000Z'),
        },
        {
          id: 'summary_human',
          playerId: 'player_human',
          season: 2026,
          playerName: 'Human Player',
          club: 'BBB',
          position: 'MID',
          averageScore: 94,
          totalValue: 94,
          statsJson: '{}',
          totalsJson: '{}',
          sourceUpdatedAt: new Date('2026-03-01T00:00:00.000Z'),
        },
      ],
    });

    await prisma.leagueRosterPlayer.createMany({
      data: [
        {
          id: 'rp_bot',
          leagueId: 'league_1',
          memberId: 'member_bot',
          playerId: 'player_bot',
          sortOrder: 0,
        },
        {
          id: 'rp_human',
          leagueId: 'league_1',
          memberId: 'member_human',
          playerId: 'player_human',
          sortOrder: 0,
        },
      ],
    });

    await prisma.trade.create({
      data: {
        id: 'trade_1',
        leagueId: 'league_1',
        proposerUserId: 'human_1',
        recipientUserId: 'bot_user_1',
        status: TradeStatus.PROPOSED,
        requestId: 'req_trade_1',
        requestPayloadHash: 'hash_1',
      },
    });

    await prisma.tradeItem.createMany({
      data: [
        {
          id: 'item_1',
          tradeId: 'trade_1',
          fromUserId: 'bot_user_1',
          toUserId: 'human_1',
          playerId: 'player_bot',
        },
        {
          id: 'item_2',
          tradeId: 'trade_1',
          fromUserId: 'human_1',
          toUserId: 'bot_user_1',
          playerId: 'player_human',
        },
      ],
    });

    acceptTradeMock.mockResolvedValue({
      tradeId: 'trade_1',
      status: 'EXECUTED',
      createdAt: new Date().toISOString(),
    });

    const result = await botManagerService.runLeagueBots({
      leagueId: 'league_1',
      actorUserId: 'owner_1',
      season: 2026,
      random: () => 0,
    });

    expect(acceptTradeMock).toHaveBeenCalledWith({
      requestId: expect.any(String),
      tradeId: 'trade_1',
      actorUserId: 'bot_user_1',
    });
    expect(declineTradeMock).not.toHaveBeenCalled();
    expect(result.actions).toEqual([
      {
        type: 'trade_accept',
        memberId: 'member_bot',
        tradeId: 'trade_1',
      },
    ]);
  });

  it('submits a waiver claim when a free agent materially upgrades the bot roster', async () => {
    await prisma.leagueBotProfile.create({
      data: {
        id: 'profile_1',
        leagueId: 'league_1',
        memberId: 'member_bot',
        personality: BotPersonality.WAIVER_HUNTER,
        allowTradeInitiation: false,
        allowTradeResponses: false,
        allowWaiverClaims: true,
        activityLevel: 100,
        waiverAggression: 100,
        minimumActionIntervalMins: 5,
      },
    });

    await prisma.player.createMany({
      data: [
        { id: 'player_low', name: 'Low Player', club: 'AAA', position: 'MID' },
        { id: 'player_free', name: 'Free Agent', club: 'BBB', position: 'MID' },
      ],
    });

    await prisma.playerSeasonSummary.createMany({
      data: [
        {
          id: 'summary_low',
          playerId: 'player_low',
          season: 2026,
          playerName: 'Low Player',
          club: 'AAA',
          position: 'MID',
          averageScore: 45,
          totalValue: 45,
          statsJson: '{}',
          totalsJson: '{}',
          sourceUpdatedAt: new Date('2026-03-01T00:00:00.000Z'),
        },
        {
          id: 'summary_free',
          playerId: 'player_free',
          season: 2026,
          playerName: 'Free Agent',
          club: 'BBB',
          position: 'MID',
          averageScore: 88,
          totalValue: 88,
          statsJson: '{}',
          totalsJson: '{}',
          sourceUpdatedAt: new Date('2026-03-01T00:00:00.000Z'),
        },
      ],
    });

    await prisma.leagueRosterPlayer.create({
      data: {
        id: 'rp_bot',
        leagueId: 'league_1',
        memberId: 'member_bot',
        playerId: 'player_low',
        sortOrder: 0,
      },
    });

    submitWaiverClaimMock.mockResolvedValue({ id: 'claim_1' });

    const result = await botManagerService.runLeagueBots({
      leagueId: 'league_1',
      actorUserId: 'owner_1',
      season: 2026,
      random: () => 0,
    });

    expect(submitWaiverClaimMock).toHaveBeenCalledWith({
      leagueId: 'league_1',
      userId: 'bot_user_1',
      teamId: 'member_bot',
      playerId: 'player_free',
      dropPlayerId: 'player_low',
      priority: 1,
      bidAmount: undefined,
    });
    expect(result.actions).toEqual([
      {
        type: 'waiver_claim',
        memberId: 'member_bot',
        claimId: 'claim_1',
        playerId: 'player_free',
      },
    ]);
  });

  it('proposes a trade when a bot has a reachable upgrade target', async () => {
    await prisma.leagueBotProfile.create({
      data: {
        id: 'profile_1',
        leagueId: 'league_1',
        memberId: 'member_bot',
        personality: BotPersonality.AGGRESSIVE,
        allowTradeInitiation: true,
        allowTradeResponses: false,
        allowWaiverClaims: false,
        activityLevel: 100,
        tradeAggression: 100,
        tradeRiskTolerance: 80,
        minimumActionIntervalMins: 5,
      },
    });

    await prisma.player.createMany({
      data: [
        { id: 'player_offer', name: 'Offer Player', club: 'AAA', position: 'MID' },
        { id: 'player_target', name: 'Target Player', club: 'BBB', position: 'MID' },
      ],
    });

    await prisma.playerSeasonSummary.createMany({
      data: [
        {
          id: 'summary_offer',
          playerId: 'player_offer',
          season: 2026,
          playerName: 'Offer Player',
          club: 'AAA',
          position: 'MID',
          averageScore: 72,
          totalValue: 72,
          statsJson: '{}',
          totalsJson: '{}',
          sourceUpdatedAt: new Date('2026-03-01T00:00:00.000Z'),
        },
        {
          id: 'summary_target',
          playerId: 'player_target',
          season: 2026,
          playerName: 'Target Player',
          club: 'BBB',
          position: 'MID',
          averageScore: 85,
          totalValue: 85,
          statsJson: '{}',
          totalsJson: '{}',
          sourceUpdatedAt: new Date('2026-03-01T00:00:00.000Z'),
        },
      ],
    });

    await prisma.leagueRosterPlayer.createMany({
      data: [
        {
          id: 'rp_bot',
          leagueId: 'league_1',
          memberId: 'member_bot',
          playerId: 'player_offer',
          sortOrder: 0,
        },
        {
          id: 'rp_human',
          leagueId: 'league_1',
          memberId: 'member_human',
          playerId: 'player_target',
          sortOrder: 0,
        },
      ],
    });

    proposeTradeMock.mockResolvedValue({
      tradeId: 'trade_offer_1',
      status: 'PROPOSED',
      createdAt: new Date().toISOString(),
    });

    const result = await botManagerService.runLeagueBots({
      leagueId: 'league_1',
      actorUserId: 'owner_1',
      season: 2026,
      random: () => 0,
    });

    expect(proposeTradeMock).toHaveBeenCalledWith({
      requestId: expect.any(String),
      leagueId: 'league_1',
      proposerUserId: 'bot_user_1',
      recipientUserId: 'human_1',
      note: 'aggressive bot offer',
      items: [
        {
          fromUserId: 'bot_user_1',
          toUserId: 'human_1',
          playerId: 'player_offer',
        },
        {
          fromUserId: 'human_1',
          toUserId: 'bot_user_1',
          playerId: 'player_target',
        },
      ],
    });
    expect(result.actions).toEqual([
      {
        type: 'trade_offer',
        memberId: 'member_bot',
        tradeId: 'trade_offer_1',
        targetUserId: 'human_1',
      },
    ]);
  });
});

if (!prismaReady && prismaError) {
  // eslint-disable-next-line no-console
  console.warn(String(prismaError));
}
