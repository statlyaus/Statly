/*
  Warnings:

  - You are about to drop the `Queue` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Team` table. If the table is not empty, all the data it contains will be lost.
  - The primary key for the `Draft` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `League` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `Pick` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `number` on the `Pick` table. All the data in the column will be lost.
  - You are about to drop the column `teamId` on the `Pick` table. All the data in the column will be lost.
  - The primary key for the `Player` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `aflTeam` on the `Player` table. All the data in the column will be lost.
  - The primary key for the `User` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `name` on the `User` table. All the data in the column will be lost.
  - Added the required column `status` to the `Draft` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalPicks` to the `Draft` table without a default value. This is not possible if the table is not empty.
  - Added the required column `inviteCode` to the `League` table without a default value. This is not possible if the table is not empty.
  - Added the required column `ownerId` to the `League` table without a default value. This is not possible if the table is not empty.
  - Added the required column `settingsId` to the `League` table without a default value. This is not possible if the table is not empty.
  - Added the required column `memberId` to the `Pick` table without a default value. This is not possible if the table is not empty.
  - Added the required column `overall` to the `Pick` table without a default value. This is not possible if the table is not empty.
  - Added the required column `slot` to the `Pick` table without a default value. This is not possible if the table is not empty.
  - Made the column `round` on table `Pick` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `club` to the `Player` table without a default value. This is not possible if the table is not empty.
  - Added the required column `position` to the `Player` table without a default value. This is not possible if the table is not empty.
  - Added the required column `displayName` to the `User` table without a default value. This is not possible if the table is not empty.
  - Added the required column `passwordHash` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Queue";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Team";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "jwtId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeagueMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "draftSlot" INTEGER,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeagueMember_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeagueMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeagueSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rosterSize" INTEGER NOT NULL,
    "benchSize" INTEGER NOT NULL,
    "maxTeams" INTEGER NOT NULL,
    "pickSeconds" INTEGER NOT NULL,
    "allowAutoPick" BOOLEAN NOT NULL DEFAULT true,
    "draftType" TEXT NOT NULL,
    "startAt" DATETIME NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "DraftOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "draftId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "memberId" TEXT NOT NULL,
    CONSTRAINT "DraftOrder_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DraftOrder_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QueueItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memberId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL
);

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
    "completedAt" DATETIME
);
INSERT INTO "new_Draft" ("id", "leagueId") SELECT "id", "leagueId" FROM "Draft";
DROP TABLE "Draft";
ALTER TABLE "new_Draft" RENAME TO "Draft";
CREATE UNIQUE INDEX "Draft_leagueId_key" ON "Draft"("leagueId");
CREATE TABLE "new_League" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "draftId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "League_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "LeagueSettings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "League_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_League" ("id", "name") SELECT "id", "name" FROM "League";
DROP TABLE "League";
ALTER TABLE "new_League" RENAME TO "League";
CREATE UNIQUE INDEX "League_inviteCode_key" ON "League"("inviteCode");
CREATE UNIQUE INDEX "League_settingsId_key" ON "League"("settingsId");
CREATE UNIQUE INDEX "League_draftId_key" ON "League"("draftId");
CREATE TABLE "new_Pick" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "draftId" TEXT NOT NULL,
    "overall" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "slot" INTEGER NOT NULL,
    "memberId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "madeAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Pick_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Pick_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Pick_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Pick" ("draftId", "id", "playerId", "round") SELECT "draftId", "id", "playerId", "round" FROM "Pick";
DROP TABLE "Pick";
ALTER TABLE "new_Pick" RENAME TO "Pick";
CREATE UNIQUE INDEX "Pick_draftId_playerId_key" ON "Pick"("draftId", "playerId");
CREATE UNIQUE INDEX "Pick_draftId_overall_key" ON "Pick"("draftId", "overall");
CREATE TABLE "new_Player" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "club" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO "new_Player" ("id", "name") SELECT "id", "name" FROM "Player";
DROP TABLE "Player";
ALTER TABLE "new_Player" RENAME TO "Player";
CREATE INDEX "Player_name_idx" ON "Player"("name");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("email", "id") SELECT "email", "id" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Session_jwtId_key" ON "Session"("jwtId");

-- CreateIndex
CREATE UNIQUE INDEX "DraftOrder_draftId_slot_key" ON "DraftOrder"("draftId", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "QueueItem_memberId_playerId_key" ON "QueueItem"("memberId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "QueueItem_memberId_rank_key" ON "QueueItem"("memberId", "rank");
