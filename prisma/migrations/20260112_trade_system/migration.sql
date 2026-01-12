-- CreateTable
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
    "executedAt" DATETIME,
    CONSTRAINT "Trade_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Trade_proposerUserId_fkey" FOREIGN KEY ("proposerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Trade_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "TradePlayerLock" (
    "playerId" TEXT NOT NULL PRIMARY KEY,
    "tradeId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TradePlayerLock_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TradePlayerLock_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
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

-- CreateTable
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

-- CreateIndex
CREATE INDEX "Trade_leagueId_status_createdAt_idx" ON "Trade"("leagueId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Trade_proposerUserId_status_createdAt_idx" ON "Trade"("proposerUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Trade_recipientUserId_status_createdAt_idx" ON "Trade"("recipientUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Trade_parentTradeId_idx" ON "Trade"("parentTradeId");

-- CreateIndex
CREATE INDEX "Trade_supersededByTradeId_idx" ON "Trade"("supersededByTradeId");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_requestId_proposerUserId_key" ON "Trade"("requestId", "proposerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_parentTradeId_key" ON "Trade"("parentTradeId");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_supersededByTradeId_key" ON "Trade"("supersededByTradeId");

-- CreateIndex
CREATE INDEX "TradeItem_playerId_idx" ON "TradeItem"("playerId");

-- CreateIndex
CREATE INDEX "TradeItem_tradeId_idx" ON "TradeItem"("tradeId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeItem_tradeId_playerId_key" ON "TradeItem"("tradeId", "playerId");

-- CreateIndex
CREATE INDEX "TradePlayerLock_tradeId_idx" ON "TradePlayerLock"("tradeId");

-- CreateIndex
CREATE INDEX "TradeAudit_tradeId_createdAt_idx" ON "TradeAudit"("tradeId", "createdAt");

-- CreateIndex
CREATE INDEX "TradeAudit_actorUserId_createdAt_idx" ON "TradeAudit"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "TradeAudit_event_idx" ON "TradeAudit"("event");

-- CreateIndex
CREATE INDEX "TradeAction_tradeId_createdAt_idx" ON "TradeAction"("tradeId", "createdAt");

-- CreateIndex
CREATE INDEX "TradeAction_actorUserId_createdAt_idx" ON "TradeAction"("actorUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TradeAction_requestId_key" ON "TradeAction"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeAction_tradeId_action_key" ON "TradeAction"("tradeId", "action");
