-- CreateTable
CREATE TABLE "LeagueBotProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "personality" TEXT NOT NULL DEFAULT 'BALANCED',
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
    "lastAutomatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LeagueBotProfile_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueBotProfile_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "LeagueBotProfile_memberId_key" ON "LeagueBotProfile"("memberId");

-- CreateIndex
CREATE INDEX "LeagueBotProfile_leagueId_enabled_idx" ON "LeagueBotProfile"("leagueId", "enabled");

-- CreateIndex
CREATE INDEX "LeagueBotProfile_memberId_enabled_idx" ON "LeagueBotProfile"("memberId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueBotProfile_leagueId_memberId_key" ON "LeagueBotProfile"("leagueId", "memberId");
