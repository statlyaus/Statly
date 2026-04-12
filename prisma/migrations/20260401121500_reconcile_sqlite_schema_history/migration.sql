-- Reconcile historical SQLite drift that was introduced outside migration history.
-- This keeps fresh replays aligned with the current Prisma datamodel without
-- forcing resets on environments that already carry the desired table shapes.

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_LeagueRoster" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "leagueId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "playerIds" TEXT NOT NULL,
  "captainId" TEXT,
  "viceCaptainId" TEXT,
  "benchOrder" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "LeagueRoster_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LeagueRoster_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_LeagueRoster" ("benchOrder", "captainId", "createdAt", "id", "leagueId", "memberId", "playerIds", "updatedAt", "viceCaptainId")
SELECT "benchOrder", "captainId", "createdAt", "id", "leagueId", "memberId", "playerIds", "updatedAt", "viceCaptainId" FROM "LeagueRoster";
DROP TABLE "LeagueRoster";
ALTER TABLE "new_LeagueRoster" RENAME TO "LeagueRoster";
CREATE INDEX "LeagueRoster_leagueId_idx" ON "LeagueRoster"("leagueId");
CREATE INDEX "LeagueRoster_memberId_idx" ON "LeagueRoster"("memberId");
CREATE UNIQUE INDEX "LeagueRoster_leagueId_memberId_key" ON "LeagueRoster"("leagueId", "memberId");

CREATE TABLE "new_TeamAction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "leagueId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "details" TEXT NOT NULL,
  "targetMemberId" TEXT,
  "processingAt" DATETIME,
  "processedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TeamAction_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TeamAction_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TeamAction" ("actionType", "createdAt", "details", "id", "leagueId", "memberId", "processedAt", "processingAt", "status", "targetMemberId", "updatedAt")
SELECT "actionType", "createdAt", "details", "id", "leagueId", "memberId", "processedAt", "processingAt", "status", "targetMemberId", "updatedAt" FROM "TeamAction";
DROP TABLE "TeamAction";
ALTER TABLE "new_TeamAction" RENAME TO "TeamAction";
CREATE INDEX "TeamAction_leagueId_status_idx" ON "TeamAction"("leagueId", "status");
CREATE INDEX "TeamAction_memberId_idx" ON "TeamAction"("memberId");
CREATE INDEX "TeamAction_actionType_idx" ON "TeamAction"("actionType");
CREATE INDEX "TeamAction_processingAt_idx" ON "TeamAction"("processingAt");

CREATE TABLE "new_TradeAudit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tradeId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "payloadJson" JSONB NOT NULL,
  "errorCode" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeAudit_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TradeAudit_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_TradeAudit" ("actorUserId", "createdAt", "errorCode", "event", "id", "payloadJson", "tradeId")
SELECT "actorUserId", "createdAt", "errorCode", "event", "id", "payloadJson", "tradeId" FROM "TradeAudit";
DROP TABLE "TradeAudit";
ALTER TABLE "new_TradeAudit" RENAME TO "TradeAudit";
CREATE INDEX "TradeAudit_tradeId_createdAt_idx" ON "TradeAudit"("tradeId", "createdAt");
CREATE INDEX "TradeAudit_actorUserId_createdAt_idx" ON "TradeAudit"("actorUserId", "createdAt");
CREATE INDEX "TradeAudit_event_idx" ON "TradeAudit"("event");

CREATE TABLE "new_WaiverClaim" (
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
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "WaiverClaim_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WaiverClaim_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WaiverClaim_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WaiverClaim_dropPlayerId_fkey" FOREIGN KEY ("dropPlayerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_WaiverClaim" ("bidAmount", "cancelledAt", "cancelledByUserId", "createdAt", "dropPlayerId", "id", "leagueId", "memberId", "playerId", "priority", "processedAt", "processingAt", "reason", "status", "updatedAt")
SELECT "bidAmount", "cancelledAt", "cancelledByUserId", "createdAt", "dropPlayerId", "id", "leagueId", "memberId", "playerId", "priority", "processedAt", "processingAt", "reason", "status", "updatedAt" FROM "WaiverClaim";
DROP TABLE "WaiverClaim";
ALTER TABLE "new_WaiverClaim" RENAME TO "WaiverClaim";
CREATE INDEX "WaiverClaim_leagueId_status_createdAt_idx" ON "WaiverClaim"("leagueId", "status", "createdAt");
CREATE INDEX "WaiverClaim_memberId_status_createdAt_idx" ON "WaiverClaim"("memberId", "status", "createdAt");
CREATE INDEX "WaiverClaim_playerId_status_createdAt_idx" ON "WaiverClaim"("playerId", "status", "createdAt");
CREATE INDEX "WaiverClaim_processingAt_idx" ON "WaiverClaim"("processingAt");

CREATE TABLE "new_WaiverPriority" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "leagueId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "currentPriority" INTEGER,
  "remainingFaab" INTEGER,
  "pendingBidTotal" INTEGER NOT NULL DEFAULT 0,
  "lastClaimDate" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "WaiverPriority_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WaiverPriority_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_WaiverPriority" ("createdAt", "currentPriority", "id", "lastClaimDate", "leagueId", "memberId", "pendingBidTotal", "remainingFaab", "updatedAt")
SELECT "createdAt", "currentPriority", "id", "lastClaimDate", "leagueId", "memberId", "pendingBidTotal", "remainingFaab", "updatedAt" FROM "WaiverPriority";
DROP TABLE "WaiverPriority";
ALTER TABLE "new_WaiverPriority" RENAME TO "WaiverPriority";
CREATE UNIQUE INDEX "WaiverPriority_memberId_key" ON "WaiverPriority"("memberId");
CREATE INDEX "WaiverPriority_leagueId_currentPriority_idx" ON "WaiverPriority"("leagueId", "currentPriority");
CREATE UNIQUE INDEX "WaiverPriority_leagueId_memberId_key" ON "WaiverPriority"("leagueId", "memberId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

CREATE INDEX IF NOT EXISTS "DraftOrder_draftId_memberId_idx" ON "DraftOrder"("draftId", "memberId");
