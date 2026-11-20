-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."LeagueRole" AS ENUM ('OWNER', 'COMMISSIONER', 'MANAGER');

-- CreateEnum
CREATE TYPE "public"."BotPersonality" AS ENUM ('BALANCED', 'AGGRESSIVE', 'OPPORTUNISTIC', 'CONSERVATIVE', 'WAIVER_HUNTER');

-- CreateEnum
CREATE TYPE "public"."DraftType" AS ENUM ('SNAKE', 'LINEAR');

-- CreateEnum
CREATE TYPE "public"."DraftStatus" AS ENUM ('SCHEDULED', 'LIVE', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "public"."DraftDirection" AS ENUM ('FORWARD', 'REVERSE');

-- CreateEnum
CREATE TYPE "public"."TradeStatus" AS ENUM ('PROPOSED', 'REVIEW_PENDING', 'DECLINED', 'REVIEW_REJECTED', 'CANCELLED', 'SUPERSEDED', 'EXPIRED', 'EXECUTED');

-- CreateEnum
CREATE TYPE "public"."TradeEvent" AS ENUM ('TRADE_PROPOSED', 'TRADE_COUNTERED', 'TRADE_REVIEW_REQUESTED', 'TRADE_REVIEW_VOTE_CAST', 'TRADE_REVIEW_APPROVED', 'TRADE_REVIEW_REJECTED', 'TRADE_DECLINED', 'TRADE_CANCELLED', 'TRADE_ACCEPTED', 'TRADE_EXECUTED', 'TRADE_FAILED');

-- CreateEnum
CREATE TYPE "public"."TradeErrorCode" AS ENUM ('TRADE_WINDOW_CLOSED', 'TRADE_NOT_FOUND', 'TRADE_FORBIDDEN', 'TRADE_INVALID_PAYLOAD', 'TRADE_INVALID_TRANSITION', 'TRADE_PLAYER_NOT_OWNED', 'TRADE_ROSTER_INVALID', 'TRADE_PLAYER_LOCKED', 'TRADE_LIMIT_REACHED', 'TRADE_IDEMPOTENCY_CONFLICT');

-- CreateEnum
CREATE TYPE "public"."TradeActionType" AS ENUM ('ACCEPT', 'DECLINE', 'CANCEL');

-- CreateEnum
CREATE TYPE "public"."TradeReviewMode" AS ENUM ('NONE', 'ADMIN', 'VETO');

-- CreateEnum
CREATE TYPE "public"."TradeReviewStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."TradeReviewVoteType" AS ENUM ('APPROVE', 'VETO');

-- CreateEnum
CREATE TYPE "public"."PlayerAliasSource" AS ENUM ('MANUAL', 'FIRESTORE_SYNC', 'ETL_DISCOVERY');

-- CreateEnum
CREATE TYPE "public"."UnresolvedPlayerStatStatus" AS ENUM ('NEW', 'REVIEWED', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "public"."TeamActionType" AS ENUM ('TRADE_PROPOSAL', 'WAIVER_CLAIM', 'DROP_PLAYER', 'SET_CAPTAIN', 'SET_VICE_CAPTAIN', 'OPTIMIZE_LINEUP');

-- CreateEnum
CREATE TYPE "public"."ActionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PROCESSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."WaiverClaimStatus" AS ENUM ('PENDING', 'SUCCESSFUL', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserCredential" (
    "userId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCredential_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "public"."Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jwtId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."League" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'private',
    "ownerId" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'preseason',
    "categoriesJson" TEXT,
    "draftDate" TIMESTAMP(3),
    "tradeLimit" INTEGER NOT NULL DEFAULT 10,
    "tradeReview" TEXT NOT NULL DEFAULT 'none',
    "tradeVetoPeriodHours" INTEGER NOT NULL DEFAULT 24,
    "tradeDeadline" TIMESTAMP(3),
    "waiverOrderJson" TEXT,
    "waiverPeriodHours" INTEGER NOT NULL DEFAULT 24,
    "waiverResetPolicy" TEXT NOT NULL DEFAULT 'weekly',
    "waiverSystem" TEXT NOT NULL DEFAULT 'ROLLING_LIST',
    "waiverPriorityMode" TEXT NOT NULL DEFAULT 'ROLLING',
    "waiverFaabBudget" INTEGER,
    "waiverMinimumBid" INTEGER NOT NULL DEFAULT 1,
    "waiverMaxWeekAcquisitions" INTEGER,
    "waiverMaxSeasonAcquisitions" INTEGER,
    "waiverMoveWinnerToBack" BOOLEAN NOT NULL DEFAULT true,
    "waiverAcquisitionLocked" BOOLEAN NOT NULL DEFAULT false,
    "cantDropListJson" TEXT,
    "settingsId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "League_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LeagueMember" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "public"."LeagueRole" NOT NULL,
    "teamName" TEXT NOT NULL,
    "draftSlot" INTEGER,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LeagueSettings" (
    "id" TEXT NOT NULL,
    "rosterSize" INTEGER NOT NULL,
    "benchSize" INTEGER NOT NULL,
    "maxTeams" INTEGER NOT NULL,
    "pickSeconds" INTEGER NOT NULL,
    "allowAutoPick" BOOLEAN NOT NULL DEFAULT true,
    "enableDraftReminders" BOOLEAN NOT NULL DEFAULT true,
    "draftType" "public"."DraftType" NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "seasonWeeks" INTEGER NOT NULL DEFAULT 12,
    "matchupsPerOpponent" INTEGER NOT NULL DEFAULT 1,
    "playoffsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "playoffTeams" INTEGER NOT NULL DEFAULT 0,
    "playoffLegLengthWeeks" INTEGER NOT NULL DEFAULT 1,
    "playoffReseedEachRound" BOOLEAN NOT NULL DEFAULT false,
    "playoffIncludeConsolation" BOOLEAN NOT NULL DEFAULT false,
    "enableCaptainSystem" BOOLEAN NOT NULL DEFAULT false,
    "captainMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "viceCaptainMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5,

    CONSTRAINT "LeagueSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Draft" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "status" "public"."DraftStatus" NOT NULL,
    "currentPick" INTEGER NOT NULL DEFAULT 1,
    "totalPicks" INTEGER NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "direction" "public"."DraftDirection" NOT NULL DEFAULT 'FORWARD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "pickStartedAt" TIMESTAMP(3),
    "pickDeadlineAt" TIMESTAMP(3),
    "pausedRemainingSeconds" INTEGER,
    "schedulingVersion" INTEGER NOT NULL DEFAULT 0,
    "lobbyStatus" TEXT DEFAULT 'CLOSED',
    "lobbyOpenAt" TIMESTAMP(3),

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DraftEvent" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" TEXT,
    "publishState" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DraftWatchlist" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DraftWatchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PreDraftQueue" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreDraftQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LobbyActivity" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LobbyActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DraftOrder" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "memberId" TEXT NOT NULL,

    CONSTRAINT "DraftOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Player" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "club" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PlayerAlias" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "aliasName" TEXT NOT NULL,
    "normalizedAliasName" TEXT NOT NULL,
    "club" TEXT,
    "normalizedClub" TEXT,
    "scopeKey" TEXT NOT NULL DEFAULT 'all:all:global',
    "source" "public"."PlayerAliasSource" NOT NULL DEFAULT 'MANUAL',
    "seasonFrom" INTEGER,
    "seasonTo" INTEGER,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "approvedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PlayerSeasonRegistration" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "club" TEXT NOT NULL,
    "normalizedClub" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "listStatus" TEXT NOT NULL DEFAULT 'active',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "source" "public"."PlayerAliasSource" NOT NULL DEFAULT 'MANUAL',
    "approvedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerSeasonRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UnresolvedPlayerStatRow" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceDocumentId" TEXT NOT NULL,
    "sourceMatchId" TEXT,
    "season" INTEGER NOT NULL,
    "round" INTEGER,
    "playerName" TEXT NOT NULL,
    "normalizedPlayerName" TEXT NOT NULL,
    "team" TEXT,
    "normalizedTeam" TEXT,
    "status" "public"."UnresolvedPlayerStatStatus" NOT NULL DEFAULT 'NEW',
    "rawPayloadJson" TEXT NOT NULL,
    "candidatePlayerIdsJson" TEXT,
    "resolutionNotes" TEXT,
    "resolvedPlayerId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnresolvedPlayerStatRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PlayerSeasonSummary" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "playerName" TEXT NOT NULL,
    "club" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "averageScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "statsJson" TEXT NOT NULL,
    "totalsJson" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerSeasonSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PlayerRankingSnapshot" (
    "id" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'season',
    "method" TEXT NOT NULL DEFAULT 'weighted_score_legacy',
    "methodVersion" INTEGER NOT NULL DEFAULT 1,
    "rank" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "club" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "averageScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rankingValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minimumGames" INTEGER NOT NULL DEFAULT 0,
    "populationSize" INTEGER NOT NULL DEFAULT 0,
    "isSmallSample" BOOLEAN NOT NULL DEFAULT false,
    "categoriesJson" TEXT NOT NULL,
    "statsJson" TEXT NOT NULL,
    "totalsJson" TEXT NOT NULL,
    "metadataJson" TEXT,
    "snapshotAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerRankingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PlayerProjectionPublication" (
    "id" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'season',
    "summaryCount" INTEGER NOT NULL DEFAULT 0,
    "rankingCount" INTEGER NOT NULL DEFAULT 0,
    "rosterCount" INTEGER NOT NULL DEFAULT 0,
    "rankingMethod" TEXT NOT NULL DEFAULT 'weighted_score_legacy',
    "rankingMethodVersion" INTEGER NOT NULL DEFAULT 1,
    "rankingMinimumGames" INTEGER NOT NULL DEFAULT 0,
    "rankingPopulationSize" INTEGER NOT NULL DEFAULT 0,
    "rankingsDirty" BOOLEAN NOT NULL DEFAULT false,
    "rankingPublishedAt" TIMESTAMP(3),
    "rankingMetadataJson" TEXT,
    "rostersDirty" BOOLEAN NOT NULL DEFAULT false,
    "rosterPublishedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerProjectionPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PlayerRecentFormSummary" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "window" TEXT NOT NULL,
    "gamesIncluded" INTEGER NOT NULL DEFAULT 0,
    "averageScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "statsJson" TEXT NOT NULL,
    "totalsJson" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerRecentFormSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PlayerLatestSnapshot" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "matchUid" TEXT,
    "round" INTEGER,
    "statSource" TEXT NOT NULL DEFAULT 'projection',
    "isLive" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3),
    "averageScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "statsJson" TEXT NOT NULL,
    "totalsJson" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerLatestSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PlayerMatchLogProjection" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "matchId" TEXT NOT NULL,
    "matchDate" TEXT NOT NULL,
    "opponent" TEXT NOT NULL,
    "statsJson" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerMatchLogProjection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LeagueRosterPlayerSummary" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "playerName" TEXT NOT NULL,
    "club" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "ownership" INTEGER NOT NULL DEFAULT 0,
    "isCaptain" BOOLEAN NOT NULL DEFAULT false,
    "isViceCaptain" BOOLEAN NOT NULL DEFAULT false,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "averageScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "price" INTEGER NOT NULL DEFAULT 0,
    "lastGameScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "projectedScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "formJson" TEXT NOT NULL,
    "statsJson" TEXT NOT NULL,
    "totalsJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueRosterPlayerSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Pick" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "overall" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "slot" INTEGER NOT NULL,
    "memberId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "madeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auto" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Pick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LeagueRoster" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "captainId" TEXT,
    "viceCaptainId" TEXT,
    "benchOrder" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueRoster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LeagueRosterPlayer" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueRosterPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LeagueBotProfile" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "personality" "public"."BotPersonality" NOT NULL DEFAULT 'BALANCED',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowTradeInitiation" BOOLEAN NOT NULL DEFAULT true,
    "allowTradeResponses" BOOLEAN NOT NULL DEFAULT true,
    "allowWaiverClaims" BOOLEAN NOT NULL DEFAULT true,
    "activityLevel" INTEGER NOT NULL DEFAULT 50,
    "tradeAggression" INTEGER NOT NULL DEFAULT 50,
    "tradeRiskTolerance" INTEGER NOT NULL DEFAULT 50,
    "waiverAggression" INTEGER NOT NULL DEFAULT 50,
    "preferredTradeCount" INTEGER NOT NULL DEFAULT 1,
    "minimumActionIntervalMins" INTEGER NOT NULL DEFAULT 180,
    "lastAutomatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeagueBotProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TeamAction" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "actionType" "public"."TeamActionType" NOT NULL,
    "status" "public"."ActionStatus" NOT NULL DEFAULT 'PENDING',
    "details" TEXT NOT NULL,
    "targetMemberId" TEXT,
    "processingAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WaiverClaim" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "dropPlayerId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "bidAmount" INTEGER,
    "status" "public"."WaiverClaimStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "processingAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaiverClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WaiverPriority" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "currentPriority" INTEGER,
    "remainingFaab" INTEGER,
    "pendingBidTotal" INTEGER NOT NULL DEFAULT 0,
    "lastClaimDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaiverPriority_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Trade" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "roundId" TEXT,
    "proposerUserId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "status" "public"."TradeStatus" NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestPayloadHash" TEXT NOT NULL,
    "parentTradeId" TEXT,
    "supersededByTradeId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "reviewMode" "public"."TradeReviewMode" NOT NULL DEFAULT 'NONE',
    "reviewStatus" "public"."TradeReviewStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "reviewRequestedAt" TIMESTAMP(3),
    "reviewWindowEndsAt" TIMESTAMP(3),
    "reviewDecidedAt" TIMESTAMP(3),
    "proposerViewedAt" TIMESTAMP(3),
    "recipientViewedAt" TIMESTAMP(3),

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TradeItem" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TradePlayerLock" (
    "leagueId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradePlayerLock_pkey" PRIMARY KEY ("leagueId","playerId")
);

-- CreateTable
CREATE TABLE "public"."TradeAudit" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "event" "public"."TradeEvent" NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "errorCode" "public"."TradeErrorCode",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TradeReviewVote" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "voterUserId" TEXT NOT NULL,
    "voteType" "public"."TradeReviewVoteType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeReviewVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TradeAction" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "action" "public"."TradeActionType" NOT NULL,
    "requestId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "public"."User"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_jwtId_key" ON "public"."Session"("jwtId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "public"."Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "public"."Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "League_inviteCode_key" ON "public"."League"("inviteCode");

-- CreateIndex
CREATE UNIQUE INDEX "League_settingsId_key" ON "public"."League"("settingsId");

-- CreateIndex
CREATE INDEX "League_ownerId_idx" ON "public"."League"("ownerId");

-- CreateIndex
CREATE INDEX "League_createdAt_idx" ON "public"."League"("createdAt");

-- CreateIndex
CREATE INDEX "LeagueMember_leagueId_idx" ON "public"."LeagueMember"("leagueId");

-- CreateIndex
CREATE INDEX "LeagueMember_userId_idx" ON "public"."LeagueMember"("userId");

-- CreateIndex
CREATE INDEX "LeagueMember_draftSlot_idx" ON "public"."LeagueMember"("draftSlot");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueMember_leagueId_userId_key" ON "public"."LeagueMember"("leagueId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Draft_leagueId_key" ON "public"."Draft"("leagueId");

-- CreateIndex
CREATE INDEX "Draft_status_idx" ON "public"."Draft"("status");

-- CreateIndex
CREATE INDEX "Draft_leagueId_idx" ON "public"."Draft"("leagueId");

-- CreateIndex
CREATE INDEX "Draft_createdAt_idx" ON "public"."Draft"("createdAt");

-- CreateIndex
CREATE INDEX "Draft_leagueId_status_idx" ON "public"."Draft"("leagueId", "status");

-- CreateIndex
CREATE INDEX "DraftEvent_draftId_createdAt_idx" ON "public"."DraftEvent"("draftId", "createdAt");

-- CreateIndex
CREATE INDEX "DraftEvent_leagueId_createdAt_idx" ON "public"."DraftEvent"("leagueId", "createdAt");

-- CreateIndex
CREATE INDEX "DraftEvent_lockedAt_createdAt_idx" ON "public"."DraftEvent"("lockedAt", "createdAt");

-- CreateIndex
CREATE INDEX "DraftEvent_publishedAt_createdAt_idx" ON "public"."DraftEvent"("publishedAt", "createdAt");

-- CreateIndex
CREATE INDEX "DraftWatchlist_draftId_memberId_idx" ON "public"."DraftWatchlist"("draftId", "memberId");

-- CreateIndex
CREATE INDEX "DraftWatchlist_playerId_idx" ON "public"."DraftWatchlist"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "DraftWatchlist_draftId_memberId_playerId_key" ON "public"."DraftWatchlist"("draftId", "memberId", "playerId");

-- CreateIndex
CREATE INDEX "PreDraftQueue_draftId_memberId_idx" ON "public"."PreDraftQueue"("draftId", "memberId");

-- CreateIndex
CREATE INDEX "PreDraftQueue_rank_idx" ON "public"."PreDraftQueue"("rank");

-- CreateIndex
CREATE UNIQUE INDEX "PreDraftQueue_draftId_memberId_playerId_key" ON "public"."PreDraftQueue"("draftId", "memberId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "PreDraftQueue_draftId_memberId_rank_key" ON "public"."PreDraftQueue"("draftId", "memberId", "rank");

-- CreateIndex
CREATE INDEX "LobbyActivity_draftId_timestamp_idx" ON "public"."LobbyActivity"("draftId", "timestamp");

-- CreateIndex
CREATE INDEX "DraftOrder_draftId_memberId_idx" ON "public"."DraftOrder"("draftId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "DraftOrder_draftId_slot_key" ON "public"."DraftOrder"("draftId", "slot");

-- CreateIndex
CREATE INDEX "Player_name_idx" ON "public"."Player"("name");

-- CreateIndex
CREATE INDEX "Player_club_idx" ON "public"."Player"("club");

-- CreateIndex
CREATE INDEX "Player_position_idx" ON "public"."Player"("position");

-- CreateIndex
CREATE INDEX "Player_active_idx" ON "public"."Player"("active");

-- CreateIndex
CREATE INDEX "PlayerAlias_playerId_idx" ON "public"."PlayerAlias"("playerId");

-- CreateIndex
CREATE INDEX "PlayerAlias_normalizedAliasName_idx" ON "public"."PlayerAlias"("normalizedAliasName");

-- CreateIndex
CREATE INDEX "PlayerAlias_normalizedAliasName_normalizedClub_idx" ON "public"."PlayerAlias"("normalizedAliasName", "normalizedClub");

-- CreateIndex
CREATE INDEX "PlayerAlias_scopeKey_idx" ON "public"."PlayerAlias"("scopeKey");

-- CreateIndex
CREATE INDEX "PlayerAlias_seasonFrom_seasonTo_idx" ON "public"."PlayerAlias"("seasonFrom", "seasonTo");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerAlias_normalizedAliasName_scopeKey_key" ON "public"."PlayerAlias"("normalizedAliasName", "scopeKey");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerAlias_playerId_normalizedAliasName_normalizedClub_sea_key" ON "public"."PlayerAlias"("playerId", "normalizedAliasName", "normalizedClub", "seasonFrom", "seasonTo");

-- CreateIndex
CREATE INDEX "PlayerSeasonRegistration_season_normalizedClub_idx" ON "public"."PlayerSeasonRegistration"("season", "normalizedClub");

-- CreateIndex
CREATE INDEX "PlayerSeasonRegistration_playerId_season_idx" ON "public"."PlayerSeasonRegistration"("playerId", "season");

-- CreateIndex
CREATE INDEX "PlayerSeasonRegistration_season_active_idx" ON "public"."PlayerSeasonRegistration"("season", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerSeasonRegistration_playerId_season_normalizedClub_key" ON "public"."PlayerSeasonRegistration"("playerId", "season", "normalizedClub");

-- CreateIndex
CREATE INDEX "UnresolvedPlayerStatRow_season_status_idx" ON "public"."UnresolvedPlayerStatRow"("season", "status");

-- CreateIndex
CREATE INDEX "UnresolvedPlayerStatRow_normalizedPlayerName_normalizedTeam_idx" ON "public"."UnresolvedPlayerStatRow"("normalizedPlayerName", "normalizedTeam");

-- CreateIndex
CREATE INDEX "UnresolvedPlayerStatRow_resolvedPlayerId_idx" ON "public"."UnresolvedPlayerStatRow"("resolvedPlayerId");

-- CreateIndex
CREATE UNIQUE INDEX "UnresolvedPlayerStatRow_source_sourceDocumentId_key" ON "public"."UnresolvedPlayerStatRow"("source", "sourceDocumentId");

-- CreateIndex
CREATE INDEX "PlayerSeasonSummary_season_idx" ON "public"."PlayerSeasonSummary"("season");

-- CreateIndex
CREATE INDEX "PlayerSeasonSummary_season_totalValue_idx" ON "public"."PlayerSeasonSummary"("season", "totalValue");

-- CreateIndex
CREATE INDEX "PlayerSeasonSummary_season_club_idx" ON "public"."PlayerSeasonSummary"("season", "club");

-- CreateIndex
CREATE INDEX "PlayerSeasonSummary_season_position_idx" ON "public"."PlayerSeasonSummary"("season", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerSeasonSummary_playerId_season_key" ON "public"."PlayerSeasonSummary"("playerId", "season");

-- CreateIndex
CREATE INDEX "PlayerRankingSnapshot_season_scope_method_methodVersion_ran_idx" ON "public"."PlayerRankingSnapshot"("season", "scope", "method", "methodVersion", "rankingValue");

-- CreateIndex
CREATE INDEX "PlayerRankingSnapshot_season_scope_method_methodVersion_pla_idx" ON "public"."PlayerRankingSnapshot"("season", "scope", "method", "methodVersion", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerRankingSnapshot_season_scope_method_methodVersion_ran_key" ON "public"."PlayerRankingSnapshot"("season", "scope", "method", "methodVersion", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerRankingSnapshot_season_scope_method_methodVersion_pla_key" ON "public"."PlayerRankingSnapshot"("season", "scope", "method", "methodVersion", "playerId");

-- CreateIndex
CREATE INDEX "PlayerProjectionPublication_scope_season_idx" ON "public"."PlayerProjectionPublication"("scope", "season");

-- CreateIndex
CREATE INDEX "PlayerProjectionPublication_scope_publishedAt_idx" ON "public"."PlayerProjectionPublication"("scope", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerProjectionPublication_season_scope_key" ON "public"."PlayerProjectionPublication"("season", "scope");

-- CreateIndex
CREATE INDEX "PlayerRecentFormSummary_season_window_totalValue_idx" ON "public"."PlayerRecentFormSummary"("season", "window", "totalValue");

-- CreateIndex
CREATE INDEX "PlayerRecentFormSummary_playerId_season_idx" ON "public"."PlayerRecentFormSummary"("playerId", "season");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerRecentFormSummary_playerId_season_window_key" ON "public"."PlayerRecentFormSummary"("playerId", "season", "window");

-- CreateIndex
CREATE INDEX "PlayerLatestSnapshot_season_isLive_sourceUpdatedAt_idx" ON "public"."PlayerLatestSnapshot"("season", "isLive", "sourceUpdatedAt");

-- CreateIndex
CREATE INDEX "PlayerLatestSnapshot_matchUid_isLive_idx" ON "public"."PlayerLatestSnapshot"("matchUid", "isLive");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerLatestSnapshot_playerId_season_key" ON "public"."PlayerLatestSnapshot"("playerId", "season");

-- CreateIndex
CREATE INDEX "PlayerMatchLogProjection_playerId_season_roundNumber_idx" ON "public"."PlayerMatchLogProjection"("playerId", "season", "roundNumber");

-- CreateIndex
CREATE INDEX "PlayerMatchLogProjection_playerId_season_matchDate_idx" ON "public"."PlayerMatchLogProjection"("playerId", "season", "matchDate");

-- CreateIndex
CREATE INDEX "PlayerMatchLogProjection_season_roundNumber_matchDate_idx" ON "public"."PlayerMatchLogProjection"("season", "roundNumber", "matchDate");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerMatchLogProjection_playerId_season_matchId_key" ON "public"."PlayerMatchLogProjection"("playerId", "season", "matchId");

-- CreateIndex
CREATE INDEX "LeagueRosterPlayerSummary_leagueId_memberId_season_sortOrde_idx" ON "public"."LeagueRosterPlayerSummary"("leagueId", "memberId", "season", "sortOrder");

-- CreateIndex
CREATE INDEX "LeagueRosterPlayerSummary_leagueId_season_playerId_idx" ON "public"."LeagueRosterPlayerSummary"("leagueId", "season", "playerId");

-- CreateIndex
CREATE INDEX "LeagueRosterPlayerSummary_memberId_season_idx" ON "public"."LeagueRosterPlayerSummary"("memberId", "season");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueRosterPlayerSummary_leagueId_memberId_playerId_season_key" ON "public"."LeagueRosterPlayerSummary"("leagueId", "memberId", "playerId", "season");

-- CreateIndex
CREATE INDEX "Pick_draftId_idx" ON "public"."Pick"("draftId");

-- CreateIndex
CREATE INDEX "Pick_memberId_idx" ON "public"."Pick"("memberId");

-- CreateIndex
CREATE INDEX "Pick_playerId_idx" ON "public"."Pick"("playerId");

-- CreateIndex
CREATE INDEX "Pick_overall_idx" ON "public"."Pick"("overall");

-- CreateIndex
CREATE INDEX "Pick_madeAt_idx" ON "public"."Pick"("madeAt");

-- CreateIndex
CREATE UNIQUE INDEX "Pick_draftId_playerId_key" ON "public"."Pick"("draftId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "Pick_draftId_overall_key" ON "public"."Pick"("draftId", "overall");

-- CreateIndex
CREATE INDEX "LeagueRoster_leagueId_idx" ON "public"."LeagueRoster"("leagueId");

-- CreateIndex
CREATE INDEX "LeagueRoster_memberId_idx" ON "public"."LeagueRoster"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueRoster_leagueId_memberId_key" ON "public"."LeagueRoster"("leagueId", "memberId");

-- CreateIndex
CREATE INDEX "LeagueRosterPlayer_leagueId_idx" ON "public"."LeagueRosterPlayer"("leagueId");

-- CreateIndex
CREATE INDEX "LeagueRosterPlayer_memberId_idx" ON "public"."LeagueRosterPlayer"("memberId");

-- CreateIndex
CREATE INDEX "LeagueRosterPlayer_playerId_idx" ON "public"."LeagueRosterPlayer"("playerId");

-- CreateIndex
CREATE INDEX "LeagueRosterPlayer_leagueId_memberId_sortOrder_idx" ON "public"."LeagueRosterPlayer"("leagueId", "memberId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueRosterPlayer_leagueId_memberId_playerId_key" ON "public"."LeagueRosterPlayer"("leagueId", "memberId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueBotProfile_memberId_key" ON "public"."LeagueBotProfile"("memberId");

-- CreateIndex
CREATE INDEX "LeagueBotProfile_leagueId_enabled_idx" ON "public"."LeagueBotProfile"("leagueId", "enabled");

-- CreateIndex
CREATE INDEX "LeagueBotProfile_memberId_enabled_idx" ON "public"."LeagueBotProfile"("memberId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueBotProfile_leagueId_memberId_key" ON "public"."LeagueBotProfile"("leagueId", "memberId");

-- CreateIndex
CREATE INDEX "TeamAction_leagueId_status_idx" ON "public"."TeamAction"("leagueId", "status");

-- CreateIndex
CREATE INDEX "TeamAction_memberId_idx" ON "public"."TeamAction"("memberId");

-- CreateIndex
CREATE INDEX "TeamAction_actionType_idx" ON "public"."TeamAction"("actionType");

-- CreateIndex
CREATE INDEX "TeamAction_processingAt_idx" ON "public"."TeamAction"("processingAt");

-- CreateIndex
CREATE INDEX "WaiverClaim_leagueId_status_createdAt_idx" ON "public"."WaiverClaim"("leagueId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WaiverClaim_memberId_status_createdAt_idx" ON "public"."WaiverClaim"("memberId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WaiverClaim_playerId_status_createdAt_idx" ON "public"."WaiverClaim"("playerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WaiverClaim_processingAt_idx" ON "public"."WaiverClaim"("processingAt");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverPriority_memberId_key" ON "public"."WaiverPriority"("memberId");

-- CreateIndex
CREATE INDEX "WaiverPriority_leagueId_currentPriority_idx" ON "public"."WaiverPriority"("leagueId", "currentPriority");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverPriority_leagueId_memberId_key" ON "public"."WaiverPriority"("leagueId", "memberId");

-- CreateIndex
CREATE INDEX "Trade_leagueId_status_createdAt_idx" ON "public"."Trade"("leagueId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Trade_proposerUserId_status_createdAt_idx" ON "public"."Trade"("proposerUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Trade_recipientUserId_status_createdAt_idx" ON "public"."Trade"("recipientUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Trade_parentTradeId_idx" ON "public"."Trade"("parentTradeId");

-- CreateIndex
CREATE INDEX "Trade_supersededByTradeId_idx" ON "public"."Trade"("supersededByTradeId");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_requestId_proposerUserId_key" ON "public"."Trade"("requestId", "proposerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_parentTradeId_key" ON "public"."Trade"("parentTradeId");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_supersededByTradeId_key" ON "public"."Trade"("supersededByTradeId");

-- CreateIndex
CREATE INDEX "TradeItem_playerId_idx" ON "public"."TradeItem"("playerId");

-- CreateIndex
CREATE INDEX "TradeItem_tradeId_idx" ON "public"."TradeItem"("tradeId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeItem_tradeId_playerId_key" ON "public"."TradeItem"("tradeId", "playerId");

-- CreateIndex
CREATE INDEX "TradePlayerLock_tradeId_idx" ON "public"."TradePlayerLock"("tradeId");

-- CreateIndex
CREATE INDEX "TradePlayerLock_leagueId_tradeId_idx" ON "public"."TradePlayerLock"("leagueId", "tradeId");

-- CreateIndex
CREATE INDEX "TradeAudit_tradeId_createdAt_idx" ON "public"."TradeAudit"("tradeId", "createdAt");

-- CreateIndex
CREATE INDEX "TradeAudit_actorUserId_createdAt_idx" ON "public"."TradeAudit"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "TradeAudit_event_idx" ON "public"."TradeAudit"("event");

-- CreateIndex
CREATE INDEX "TradeReviewVote_tradeId_createdAt_idx" ON "public"."TradeReviewVote"("tradeId", "createdAt");

-- CreateIndex
CREATE INDEX "TradeReviewVote_voterUserId_createdAt_idx" ON "public"."TradeReviewVote"("voterUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TradeReviewVote_tradeId_voterUserId_key" ON "public"."TradeReviewVote"("tradeId", "voterUserId");

-- CreateIndex
CREATE INDEX "TradeAction_tradeId_createdAt_idx" ON "public"."TradeAction"("tradeId", "createdAt");

-- CreateIndex
CREATE INDEX "TradeAction_actorUserId_createdAt_idx" ON "public"."TradeAction"("actorUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TradeAction_requestId_key" ON "public"."TradeAction"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeAction_tradeId_action_key" ON "public"."TradeAction"("tradeId", "action");

-- AddForeignKey
ALTER TABLE "public"."UserCredential" ADD CONSTRAINT "UserCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."League" ADD CONSTRAINT "League_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."League" ADD CONSTRAINT "League_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "public"."LeagueSettings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeagueMember" ADD CONSTRAINT "LeagueMember_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeagueMember" ADD CONSTRAINT "LeagueMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Draft" ADD CONSTRAINT "Draft_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DraftEvent" ADD CONSTRAINT "DraftEvent_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "public"."Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DraftEvent" ADD CONSTRAINT "DraftEvent_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DraftWatchlist" ADD CONSTRAINT "DraftWatchlist_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "public"."Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DraftWatchlist" ADD CONSTRAINT "DraftWatchlist_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DraftWatchlist" ADD CONSTRAINT "DraftWatchlist_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "public"."Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PreDraftQueue" ADD CONSTRAINT "PreDraftQueue_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "public"."Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PreDraftQueue" ADD CONSTRAINT "PreDraftQueue_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PreDraftQueue" ADD CONSTRAINT "PreDraftQueue_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "public"."Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LobbyActivity" ADD CONSTRAINT "LobbyActivity_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "public"."Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LobbyActivity" ADD CONSTRAINT "LobbyActivity_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DraftOrder" ADD CONSTRAINT "DraftOrder_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."LeagueMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DraftOrder" ADD CONSTRAINT "DraftOrder_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "public"."Draft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PlayerAlias" ADD CONSTRAINT "PlayerAlias_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "public"."Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PlayerSeasonRegistration" ADD CONSTRAINT "PlayerSeasonRegistration_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "public"."Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UnresolvedPlayerStatRow" ADD CONSTRAINT "UnresolvedPlayerStatRow_resolvedPlayerId_fkey" FOREIGN KEY ("resolvedPlayerId") REFERENCES "public"."Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PlayerSeasonSummary" ADD CONSTRAINT "PlayerSeasonSummary_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "public"."Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PlayerRankingSnapshot" ADD CONSTRAINT "PlayerRankingSnapshot_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "public"."Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PlayerRecentFormSummary" ADD CONSTRAINT "PlayerRecentFormSummary_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "public"."Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PlayerLatestSnapshot" ADD CONSTRAINT "PlayerLatestSnapshot_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "public"."Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PlayerMatchLogProjection" ADD CONSTRAINT "PlayerMatchLogProjection_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "public"."Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeagueRosterPlayerSummary" ADD CONSTRAINT "LeagueRosterPlayerSummary_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeagueRosterPlayerSummary" ADD CONSTRAINT "LeagueRosterPlayerSummary_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeagueRosterPlayerSummary" ADD CONSTRAINT "LeagueRosterPlayerSummary_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "public"."Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Pick" ADD CONSTRAINT "Pick_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "public"."Draft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Pick" ADD CONSTRAINT "Pick_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."LeagueMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Pick" ADD CONSTRAINT "Pick_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "public"."Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeagueRoster" ADD CONSTRAINT "LeagueRoster_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeagueRoster" ADD CONSTRAINT "LeagueRoster_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeagueRoster" ADD CONSTRAINT "LeagueRoster_captainId_fkey" FOREIGN KEY ("captainId") REFERENCES "public"."Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeagueRoster" ADD CONSTRAINT "LeagueRoster_viceCaptainId_fkey" FOREIGN KEY ("viceCaptainId") REFERENCES "public"."Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeagueRosterPlayer" ADD CONSTRAINT "LeagueRosterPlayer_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeagueRosterPlayer" ADD CONSTRAINT "LeagueRosterPlayer_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeagueRosterPlayer" ADD CONSTRAINT "LeagueRosterPlayer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "public"."Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeagueBotProfile" ADD CONSTRAINT "LeagueBotProfile_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeagueBotProfile" ADD CONSTRAINT "LeagueBotProfile_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TeamAction" ADD CONSTRAINT "TeamAction_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TeamAction" ADD CONSTRAINT "TeamAction_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WaiverClaim" ADD CONSTRAINT "WaiverClaim_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WaiverClaim" ADD CONSTRAINT "WaiverClaim_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WaiverClaim" ADD CONSTRAINT "WaiverClaim_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "public"."Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WaiverClaim" ADD CONSTRAINT "WaiverClaim_dropPlayerId_fkey" FOREIGN KEY ("dropPlayerId") REFERENCES "public"."Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WaiverPriority" ADD CONSTRAINT "WaiverPriority_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WaiverPriority" ADD CONSTRAINT "WaiverPriority_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Trade" ADD CONSTRAINT "Trade_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Trade" ADD CONSTRAINT "Trade_proposerUserId_fkey" FOREIGN KEY ("proposerUserId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Trade" ADD CONSTRAINT "Trade_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TradeItem" ADD CONSTRAINT "TradeItem_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "public"."Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TradeItem" ADD CONSTRAINT "TradeItem_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TradeItem" ADD CONSTRAINT "TradeItem_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TradeItem" ADD CONSTRAINT "TradeItem_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "public"."Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TradePlayerLock" ADD CONSTRAINT "TradePlayerLock_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "public"."Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TradePlayerLock" ADD CONSTRAINT "TradePlayerLock_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "public"."Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TradeAudit" ADD CONSTRAINT "TradeAudit_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "public"."Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TradeAudit" ADD CONSTRAINT "TradeAudit_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TradeReviewVote" ADD CONSTRAINT "TradeReviewVote_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "public"."Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TradeReviewVote" ADD CONSTRAINT "TradeReviewVote_voterUserId_fkey" FOREIGN KEY ("voterUserId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TradeAction" ADD CONSTRAINT "TradeAction_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "public"."Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TradeAction" ADD CONSTRAINT "TradeAction_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

