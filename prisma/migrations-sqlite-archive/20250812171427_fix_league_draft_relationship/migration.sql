/*
  Warnings:

  - You are about to drop the column `draftId` on the `League` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Draft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentPick" INTEGER NOT NULL DEFAULT 1,
    "totalPicks" INTEGER NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "direction" TEXT NOT NULL DEFAULT 'FORWARD',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    CONSTRAINT "Draft_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Draft" ("completedAt", "createdAt", "currentPick", "direction", "id", "leagueId", "round", "startedAt", "status", "totalPicks") SELECT "completedAt", "createdAt", "currentPick", "direction", "id", "leagueId", "round", "startedAt", "status", "totalPicks" FROM "Draft";
DROP TABLE "Draft";
ALTER TABLE "new_Draft" RENAME TO "Draft";
CREATE UNIQUE INDEX "Draft_leagueId_key" ON "Draft"("leagueId");
CREATE TABLE "new_League" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "League_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "LeagueSettings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_League" ("createdAt", "id", "inviteCode", "name", "ownerId", "settingsId") SELECT "createdAt", "id", "inviteCode", "name", "ownerId", "settingsId" FROM "League";
DROP TABLE "League";
ALTER TABLE "new_League" RENAME TO "League";
CREATE UNIQUE INDEX "League_inviteCode_key" ON "League"("inviteCode");
CREATE UNIQUE INDEX "League_settingsId_key" ON "League"("settingsId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
