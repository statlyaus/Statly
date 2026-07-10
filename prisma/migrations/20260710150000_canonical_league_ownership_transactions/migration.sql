CREATE UNIQUE INDEX "LeagueMember_leagueId_userId_key" ON "LeagueMember"("leagueId", "userId");

CREATE TABLE "LeagueWaiverHold" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "releasedByMemberId" TEXT NOT NULL,
    "availableAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LeagueWaiverHold_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueWaiverHold_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueWaiverHold_releasedByMemberId_fkey" FOREIGN KEY ("releasedByMemberId") REFERENCES "LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LeagueWaiverHold_leagueId_playerId_key" ON "LeagueWaiverHold"("leagueId", "playerId");
CREATE INDEX "LeagueWaiverHold_leagueId_availableAt_idx" ON "LeagueWaiverHold"("leagueId", "availableAt");
CREATE INDEX "LeagueWaiverHold_releasedByMemberId_idx" ON "LeagueWaiverHold"("releasedByMemberId");

CREATE TABLE "LeagueTrade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "proposerMemberId" TEXT NOT NULL,
    "recipientMemberId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "processedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LeagueTrade_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueTrade_proposerMemberId_fkey" FOREIGN KEY ("proposerMemberId") REFERENCES "LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueTrade_recipientMemberId_fkey" FOREIGN KEY ("recipientMemberId") REFERENCES "LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "LeagueTrade_leagueId_status_idx" ON "LeagueTrade"("leagueId", "status");
CREATE INDEX "LeagueTrade_proposerMemberId_status_idx" ON "LeagueTrade"("proposerMemberId", "status");
CREATE INDEX "LeagueTrade_recipientMemberId_status_idx" ON "LeagueTrade"("recipientMemberId", "status");

CREATE TABLE "LeagueTradePlayer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tradeId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "fromMemberId" TEXT NOT NULL,
    "toMemberId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeagueTradePlayer_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "LeagueTrade"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueTradePlayer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueTradePlayer_fromMemberId_fkey" FOREIGN KEY ("fromMemberId") REFERENCES "LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueTradePlayer_toMemberId_fkey" FOREIGN KEY ("toMemberId") REFERENCES "LeagueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LeagueTradePlayer_tradeId_playerId_key" ON "LeagueTradePlayer"("tradeId", "playerId");
CREATE INDEX "LeagueTradePlayer_fromMemberId_idx" ON "LeagueTradePlayer"("fromMemberId");
CREATE INDEX "LeagueTradePlayer_toMemberId_idx" ON "LeagueTradePlayer"("toMemberId");
