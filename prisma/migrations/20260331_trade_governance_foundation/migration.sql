ALTER TABLE "Trade" ADD COLUMN "acceptedAt" DATETIME;
ALTER TABLE "Trade" ADD COLUMN "reviewMode" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "Trade" ADD COLUMN "reviewStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED';
ALTER TABLE "Trade" ADD COLUMN "reviewRequestedAt" DATETIME;
ALTER TABLE "Trade" ADD COLUMN "reviewWindowEndsAt" DATETIME;
ALTER TABLE "Trade" ADD COLUMN "reviewDecidedAt" DATETIME;

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
CREATE INDEX "TradeReviewVote_tradeId_createdAt_idx" ON "TradeReviewVote"("tradeId", "createdAt");
CREATE INDEX "TradeReviewVote_voterUserId_createdAt_idx" ON "TradeReviewVote"("voterUserId", "createdAt");

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

ALTER TABLE "TradePlayerLock" RENAME TO "TradePlayerLock_old";

CREATE TABLE "TradePlayerLock" (
    "leagueId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TradePlayerLock_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TradePlayerLock_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY ("leagueId", "playerId")
);

INSERT INTO "TradePlayerLock" ("leagueId", "playerId", "tradeId", "createdAt")
SELECT "Trade"."leagueId", "TradePlayerLock_old"."playerId", "TradePlayerLock_old"."tradeId", "TradePlayerLock_old"."createdAt"
FROM "TradePlayerLock_old"
INNER JOIN "Trade" ON "Trade"."id" = "TradePlayerLock_old"."tradeId";

DROP TABLE "TradePlayerLock_old";

CREATE INDEX "TradePlayerLock_tradeId_idx" ON "TradePlayerLock"("tradeId");
CREATE INDEX "TradePlayerLock_leagueId_tradeId_idx" ON "TradePlayerLock"("leagueId", "tradeId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
