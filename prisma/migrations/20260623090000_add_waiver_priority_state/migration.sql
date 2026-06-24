CREATE TABLE "WaiverPriority" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "remainingFAAB" REAL,
    "pendingBidTotal" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "WaiverPriority_leagueId_memberId_key" ON "WaiverPriority"("leagueId", "memberId");
CREATE INDEX "WaiverPriority_leagueId_priority_idx" ON "WaiverPriority"("leagueId", "priority");
CREATE INDEX "WaiverPriority_memberId_idx" ON "WaiverPriority"("memberId");
