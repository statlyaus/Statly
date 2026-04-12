-- Pre-migration integrity: safe to run on existing SQLite databases before new FKs.
-- 1) DraftEvent.leagueId must match parent Draft (required for DraftEvent -> League FK).
UPDATE "DraftEvent"
SET "leagueId" = (SELECT "leagueId" FROM "Draft" WHERE "Draft"."id" = "DraftEvent"."draftId")
WHERE EXISTS (SELECT 1 FROM "Draft" WHERE "Draft"."id" = "DraftEvent"."draftId");

DELETE FROM "DraftEvent"
WHERE NOT EXISTS (SELECT 1 FROM "Draft" WHERE "Draft"."id" = "DraftEvent"."draftId");

-- 2) Captain / vice must reference Player when set (required for LeagueRoster -> Player FKs).
UPDATE "LeagueRoster"
SET "captainId" = NULL
WHERE "captainId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Player" p WHERE p."id" = "LeagueRoster"."captainId");

UPDATE "LeagueRoster"
SET "viceCaptainId" = NULL
WHERE "viceCaptainId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Player" p WHERE p."id" = "LeagueRoster"."viceCaptainId");

-- 3) League.ownerId must reference User (required for League -> User FK).
UPDATE "League"
SET "ownerId" = (
  SELECT lm."userId"
  FROM "LeagueMember" lm
  WHERE lm."leagueId" = "League"."id"
  ORDER BY
    CASE lm."role"
      WHEN 'OWNER' THEN 0
      WHEN 'COMMISSIONER' THEN 1
      ELSE 2
    END,
    lm."joinedAt" ASC
  LIMIT 1
)
WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = "League"."ownerId")
  AND EXISTS (SELECT 1 FROM "LeagueMember" lm WHERE lm."leagueId" = "League"."id");

-- DropIndex
DROP INDEX "QueueItem_memberId_rank_key";

-- DropIndex
DROP INDEX "QueueItem_memberId_playerId_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "QueueItem";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DraftEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "draftId" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" TEXT,
    "publishState" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lockedAt" DATETIME,
    "lockedBy" TEXT,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DraftEvent_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DraftEvent_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DraftEvent" ("attempts", "createdAt", "draftId", "event", "id", "lastError", "leagueId", "lockedAt", "lockedBy", "payload", "publishState", "publishedAt") SELECT "attempts", "createdAt", "draftId", "event", "id", "lastError", "leagueId", "lockedAt", "lockedBy", "payload", "publishState", "publishedAt" FROM "DraftEvent";
DROP TABLE "DraftEvent";
ALTER TABLE "new_DraftEvent" RENAME TO "DraftEvent";
CREATE INDEX "DraftEvent_draftId_createdAt_idx" ON "DraftEvent"("draftId", "createdAt");
CREATE INDEX "DraftEvent_leagueId_createdAt_idx" ON "DraftEvent"("leagueId", "createdAt");
CREATE INDEX "DraftEvent_lockedAt_createdAt_idx" ON "DraftEvent"("lockedAt", "createdAt");
CREATE INDEX "DraftEvent_publishedAt_createdAt_idx" ON "DraftEvent"("publishedAt", "createdAt");
CREATE TABLE "new_League" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
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
    "waiverMoveWinnerToBack" BOOLEAN NOT NULL DEFAULT true,
    "waiverAcquisitionLocked" BOOLEAN NOT NULL DEFAULT false,
    "cantDropListJson" TEXT,
    "settingsId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "League_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "League_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "LeagueSettings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_League" ("cantDropListJson", "categoriesJson", "createdAt", "description", "draftDate", "id", "inviteCode", "name", "ownerId", "settingsId", "status", "tradeDeadline", "tradeLimit", "tradeReview", "tradeVetoPeriodHours", "type", "waiverAcquisitionLocked", "waiverFaabBudget", "waiverMaxSeasonAcquisitions", "waiverMaxWeekAcquisitions", "waiverMinimumBid", "waiverMoveWinnerToBack", "waiverOrderJson", "waiverPeriodHours", "waiverPriorityMode", "waiverResetPolicy", "waiverSystem") SELECT "cantDropListJson", "categoriesJson", "createdAt", "description", "draftDate", "id", "inviteCode", "name", "ownerId", "settingsId", "status", "tradeDeadline", "tradeLimit", "tradeReview", "tradeVetoPeriodHours", "type", "waiverAcquisitionLocked", "waiverFaabBudget", "waiverMaxSeasonAcquisitions", "waiverMaxWeekAcquisitions", "waiverMinimumBid", "waiverMoveWinnerToBack", "waiverOrderJson", "waiverPeriodHours", "waiverPriorityMode", "waiverResetPolicy", "waiverSystem" FROM "League";
DROP TABLE "League";
ALTER TABLE "new_League" RENAME TO "League";
CREATE UNIQUE INDEX "League_inviteCode_key" ON "League"("inviteCode");
CREATE UNIQUE INDEX "League_settingsId_key" ON "League"("settingsId");
CREATE INDEX "League_ownerId_idx" ON "League"("ownerId");
CREATE INDEX "League_createdAt_idx" ON "League"("createdAt");
CREATE INDEX "League_inviteCode_idx" ON "League"("inviteCode");
CREATE TABLE "new_LeagueRoster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "captainId" TEXT,
    "viceCaptainId" TEXT,
    "benchOrder" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LeagueRoster_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueRoster_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueRoster_captainId_fkey" FOREIGN KEY ("captainId") REFERENCES "Player" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LeagueRoster_viceCaptainId_fkey" FOREIGN KEY ("viceCaptainId") REFERENCES "Player" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LeagueRoster" ("benchOrder", "captainId", "createdAt", "id", "leagueId", "memberId", "updatedAt", "viceCaptainId") SELECT "benchOrder", "captainId", "createdAt", "id", "leagueId", "memberId", "updatedAt", "viceCaptainId" FROM "LeagueRoster";
DROP TABLE "LeagueRoster";
ALTER TABLE "new_LeagueRoster" RENAME TO "LeagueRoster";
CREATE INDEX "LeagueRoster_leagueId_idx" ON "LeagueRoster"("leagueId");
CREATE INDEX "LeagueRoster_memberId_idx" ON "LeagueRoster"("memberId");
CREATE UNIQUE INDEX "LeagueRoster_leagueId_memberId_key" ON "LeagueRoster"("leagueId", "memberId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
