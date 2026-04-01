ALTER TABLE "League" ADD COLUMN "waiverSystem" TEXT NOT NULL DEFAULT 'ROLLING_LIST';
ALTER TABLE "League" ADD COLUMN "waiverPriorityMode" TEXT NOT NULL DEFAULT 'ROLLING';
ALTER TABLE "League" ADD COLUMN "waiverFaabBudget" INTEGER;
ALTER TABLE "League" ADD COLUMN "waiverMinimumBid" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "League" ADD COLUMN "waiverMaxWeekAcquisitions" INTEGER;
ALTER TABLE "League" ADD COLUMN "waiverMaxSeasonAcquisitions" INTEGER;
ALTER TABLE "League" ADD COLUMN "waiverMoveWinnerToBack" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "League" ADD COLUMN "waiverAcquisitionLocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "League" ADD COLUMN "cantDropListJson" TEXT;

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
  CONSTRAINT "WaiverClaim_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WaiverClaim_dropPlayerId_fkey" FOREIGN KEY ("dropPlayerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "WaiverPriority" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "leagueId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "currentPriority" INTEGER,
  "remainingFaab" INTEGER,
  "pendingBidTotal" INTEGER NOT NULL DEFAULT 0,
  "lastClaimDate" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaiverPriority_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WaiverPriority_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WaiverPriority_memberId_key" ON "WaiverPriority"("memberId");
CREATE UNIQUE INDEX "WaiverPriority_leagueId_memberId_key" ON "WaiverPriority"("leagueId", "memberId");
CREATE INDEX "WaiverClaim_leagueId_status_createdAt_idx" ON "WaiverClaim"("leagueId", "status", "createdAt");
CREATE INDEX "WaiverClaim_memberId_status_createdAt_idx" ON "WaiverClaim"("memberId", "status", "createdAt");
CREATE INDEX "WaiverClaim_playerId_status_createdAt_idx" ON "WaiverClaim"("playerId", "status", "createdAt");
CREATE INDEX "WaiverClaim_processingAt_idx" ON "WaiverClaim"("processingAt");
CREATE INDEX "WaiverPriority_leagueId_currentPriority_idx" ON "WaiverPriority"("leagueId", "currentPriority");
