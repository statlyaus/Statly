-- Persist league trade governance instead of deriving it from client defaults.
ALTER TABLE "LeagueSettings" ADD COLUMN "tradeLimit" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "LeagueSettings" ADD COLUMN "tradeReviewMode" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "LeagueSettings" ADD COLUMN "tradeDeadline" DATETIME;
ALTER TABLE "LeagueSettings" ADD COLUMN "tradeOfferExpiryHours" INTEGER NOT NULL DEFAULT 72;
ALTER TABLE "LeagueSettings" ADD COLUMN "tradeReviewHours" INTEGER NOT NULL DEFAULT 24;
ALTER TABLE "LeagueSettings" ADD COLUMN "tradeVetoThreshold" INTEGER NOT NULL DEFAULT 3;

CREATE TABLE "LeagueTradeThread" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "memberOneId" TEXT NOT NULL,
    "memberTwoId" TEXT NOT NULL,
    "currentOfferId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 0,
    "reviewEndsAt" DATETIME,
    "completedAt" DATETIME,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LeagueTradeThread_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueTradeThread_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueTradeThread_memberOneId_fkey" FOREIGN KEY ("memberOneId") REFERENCES "LeagueMember" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeagueTradeThread_memberTwoId_fkey" FOREIGN KEY ("memberTwoId") REFERENCES "LeagueMember" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeagueTradeThread_currentOfferId_fkey" FOREIGN KEY ("currentOfferId") REFERENCES "LeagueTradeOffer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "LeagueTradeOffer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "threadId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "proposerMemberId" TEXT NOT NULL,
    "recipientMemberId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "reviewMode" TEXT NOT NULL,
    "reviewHours" INTEGER NOT NULL,
    "vetoThreshold" INTEGER NOT NULL,
    "acceptedAt" DATETIME,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LeagueTradeOffer_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "LeagueTradeThread" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueTradeOffer_proposerMemberId_fkey" FOREIGN KEY ("proposerMemberId") REFERENCES "LeagueMember" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeagueTradeOffer_recipientMemberId_fkey" FOREIGN KEY ("recipientMemberId") REFERENCES "LeagueMember" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "LeagueTradePlayer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "offerId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "fromMemberId" TEXT NOT NULL,
    "toMemberId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeagueTradePlayer_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "LeagueTradeOffer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueTradePlayer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeagueTradePlayer_fromMemberId_fkey" FOREIGN KEY ("fromMemberId") REFERENCES "LeagueMember" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeagueTradePlayer_toMemberId_fkey" FOREIGN KEY ("toMemberId") REFERENCES "LeagueMember" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "LeagueTradeVeto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "offerId" TEXT NOT NULL,
    "voterMemberId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeagueTradeVeto_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "LeagueTradeOffer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueTradeVeto_voterMemberId_fkey" FOREIGN KEY ("voterMemberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "LeagueTradeEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "threadId" TEXT NOT NULL,
    "offerId" TEXT,
    "actorMemberId" TEXT,
    "eventType" TEXT NOT NULL,
    "previousStatus" TEXT,
    "nextStatus" TEXT NOT NULL,
    "reasonCode" TEXT,
    "payloadJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeagueTradeEvent_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "LeagueTradeThread" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueTradeEvent_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "LeagueTradeOffer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LeagueTradeEvent_actorMemberId_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "LeagueMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "LeagueTradeCommand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorMemberId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "commandType" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "resultThreadId" TEXT,
    "resultOfferId" TEXT,
    "responseJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME,
    CONSTRAINT "LeagueTradeCommand_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueTradeCommand_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueTradeCommand_actorMemberId_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "LeagueMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "LeagueTradeOutboxEvent" (
    "sequence" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "offerId" TEXT,
    "eventType" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" DATETIME,
    "lockedBy" TEXT,
    "publishedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeagueTradeOutboxEvent_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueTradeOutboxEvent_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueTradeOutboxEvent_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "LeagueTradeThread" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueTradeOutboxEvent_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "LeagueTradeOffer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LeagueTradeThread_currentOfferId_key" ON "LeagueTradeThread"("currentOfferId");
CREATE INDEX "LeagueTradeThread_leagueId_status_updatedAt_idx" ON "LeagueTradeThread"("leagueId", "status", "updatedAt");
CREATE INDEX "LeagueTradeThread_seasonId_status_updatedAt_idx" ON "LeagueTradeThread"("seasonId", "status", "updatedAt");
CREATE INDEX "LeagueTradeThread_memberOneId_status_updatedAt_idx" ON "LeagueTradeThread"("memberOneId", "status", "updatedAt");
CREATE INDEX "LeagueTradeThread_memberTwoId_status_updatedAt_idx" ON "LeagueTradeThread"("memberTwoId", "status", "updatedAt");
CREATE INDEX "LeagueTradeOffer_recipientMemberId_status_updatedAt_idx" ON "LeagueTradeOffer"("recipientMemberId", "status", "updatedAt");
CREATE INDEX "LeagueTradeOffer_proposerMemberId_status_updatedAt_idx" ON "LeagueTradeOffer"("proposerMemberId", "status", "updatedAt");
CREATE INDEX "LeagueTradeOffer_status_expiresAt_idx" ON "LeagueTradeOffer"("status", "expiresAt");
CREATE UNIQUE INDEX "LeagueTradeOffer_threadId_sequence_key" ON "LeagueTradeOffer"("threadId", "sequence");
CREATE INDEX "LeagueTradePlayer_playerId_idx" ON "LeagueTradePlayer"("playerId");
CREATE INDEX "LeagueTradePlayer_fromMemberId_idx" ON "LeagueTradePlayer"("fromMemberId");
CREATE INDEX "LeagueTradePlayer_toMemberId_idx" ON "LeagueTradePlayer"("toMemberId");
CREATE UNIQUE INDEX "LeagueTradePlayer_offerId_playerId_key" ON "LeagueTradePlayer"("offerId", "playerId");
CREATE INDEX "LeagueTradeVeto_voterMemberId_createdAt_idx" ON "LeagueTradeVeto"("voterMemberId", "createdAt");
CREATE UNIQUE INDEX "LeagueTradeVeto_offerId_voterMemberId_key" ON "LeagueTradeVeto"("offerId", "voterMemberId");
CREATE INDEX "LeagueTradeEvent_threadId_createdAt_idx" ON "LeagueTradeEvent"("threadId", "createdAt");
CREATE INDEX "LeagueTradeEvent_offerId_createdAt_idx" ON "LeagueTradeEvent"("offerId", "createdAt");
CREATE INDEX "LeagueTradeEvent_actorMemberId_createdAt_idx" ON "LeagueTradeEvent"("actorMemberId", "createdAt");
CREATE INDEX "LeagueTradeCommand_seasonId_createdAt_idx" ON "LeagueTradeCommand"("seasonId", "createdAt");
CREATE INDEX "LeagueTradeCommand_expiresAt_idx" ON "LeagueTradeCommand"("expiresAt");
CREATE UNIQUE INDEX "LeagueTradeCommand_leagueId_actorUserId_idempotencyKey_key" ON "LeagueTradeCommand"("leagueId", "actorUserId", "idempotencyKey");
CREATE UNIQUE INDEX "LeagueTradeOutboxEvent_id_key" ON "LeagueTradeOutboxEvent"("id");
CREATE INDEX "LeagueTradeOutboxEvent_status_availableAt_createdAt_idx" ON "LeagueTradeOutboxEvent"("status", "availableAt", "createdAt");
CREATE INDEX "LeagueTradeOutboxEvent_leagueId_seasonId_createdAt_idx" ON "LeagueTradeOutboxEvent"("leagueId", "seasonId", "createdAt");
CREATE INDEX "LeagueTradeOutboxEvent_threadId_sequence_idx" ON "LeagueTradeOutboxEvent"("threadId", "sequence");
CREATE INDEX "LeagueTradeOutboxEvent_lockedAt_createdAt_idx" ON "LeagueTradeOutboxEvent"("lockedAt", "createdAt");
