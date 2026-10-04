-- CreateTable
CREATE TABLE "DraftWatchlist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "draftId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DraftWatchlist_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DraftWatchlist_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DraftWatchlist_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PreDraftQueue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "draftId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PreDraftQueue_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PreDraftQueue_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PreDraftQueue_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LobbyActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "draftId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LobbyActivity_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "Draft" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LobbyActivity_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeagueRoster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "playerIds" TEXT NOT NULL,
    "captainId" TEXT,
    "viceCaptainId" TEXT,
    "benchOrder" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TeamAction" (
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
    "updatedAt" DATETIME NOT NULL
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
    "completedAt" DATETIME,
    "schedulingVersion" INTEGER NOT NULL DEFAULT 0,
    "lobbyStatus" TEXT DEFAULT 'CLOSED',
    "lobbyOpenAt" DATETIME,
    CONSTRAINT "Draft_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Draft" ("completedAt", "createdAt", "currentPick", "direction", "id", "leagueId", "round", "startedAt", "status", "totalPicks") SELECT "completedAt", "createdAt", "currentPick", "direction", "id", "leagueId", "round", "startedAt", "status", "totalPicks" FROM "Draft";
DROP TABLE "Draft";
ALTER TABLE "new_Draft" RENAME TO "Draft";
CREATE UNIQUE INDEX "Draft_leagueId_key" ON "Draft"("leagueId");
CREATE INDEX "Draft_status_idx" ON "Draft"("status");
CREATE INDEX "Draft_leagueId_idx" ON "Draft"("leagueId");
CREATE INDEX "Draft_createdAt_idx" ON "Draft"("createdAt");
CREATE INDEX "Draft_leagueId_status_idx" ON "Draft"("leagueId", "status");
CREATE TABLE "new_LeagueSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rosterSize" INTEGER NOT NULL,
    "benchSize" INTEGER NOT NULL,
    "maxTeams" INTEGER NOT NULL,
    "pickSeconds" INTEGER NOT NULL,
    "allowAutoPick" BOOLEAN NOT NULL DEFAULT true,
    "draftType" TEXT NOT NULL,
    "startAt" DATETIME NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "enableCaptainSystem" BOOLEAN NOT NULL DEFAULT false,
    "captainMultiplier" REAL NOT NULL DEFAULT 2.0,
    "viceCaptainMultiplier" REAL NOT NULL DEFAULT 1.5
);
INSERT INTO "new_LeagueSettings" ("allowAutoPick", "benchSize", "draftType", "id", "locked", "maxTeams", "pickSeconds", "rosterSize", "startAt") SELECT "allowAutoPick", "benchSize", "draftType", "id", "locked", "maxTeams", "pickSeconds", "rosterSize", "startAt" FROM "LeagueSettings";
DROP TABLE "LeagueSettings";
ALTER TABLE "new_LeagueSettings" RENAME TO "LeagueSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "DraftWatchlist_draftId_memberId_idx" ON "DraftWatchlist"("draftId", "memberId");

-- CreateIndex
CREATE INDEX "DraftWatchlist_playerId_idx" ON "DraftWatchlist"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "DraftWatchlist_draftId_memberId_playerId_key" ON "DraftWatchlist"("draftId", "memberId", "playerId");

-- CreateIndex
CREATE INDEX "PreDraftQueue_draftId_memberId_idx" ON "PreDraftQueue"("draftId", "memberId");

-- CreateIndex
CREATE INDEX "PreDraftQueue_rank_idx" ON "PreDraftQueue"("rank");

-- CreateIndex
CREATE UNIQUE INDEX "PreDraftQueue_draftId_memberId_playerId_key" ON "PreDraftQueue"("draftId", "memberId", "playerId");

-- CreateIndex
CREATE INDEX "LobbyActivity_draftId_timestamp_idx" ON "LobbyActivity"("draftId", "timestamp");

-- CreateIndex
CREATE INDEX "LeagueRoster_leagueId_idx" ON "LeagueRoster"("leagueId");

-- CreateIndex
CREATE INDEX "LeagueRoster_memberId_idx" ON "LeagueRoster"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueRoster_leagueId_memberId_key" ON "LeagueRoster"("leagueId", "memberId");

-- CreateIndex
CREATE INDEX "TeamAction_leagueId_status_idx" ON "TeamAction"("leagueId", "status");

-- CreateIndex
CREATE INDEX "TeamAction_memberId_idx" ON "TeamAction"("memberId");

-- CreateIndex
CREATE INDEX "TeamAction_actionType_idx" ON "TeamAction"("actionType");

-- CreateIndex
CREATE INDEX "TeamAction_processingAt_idx" ON "TeamAction"("processingAt");

-- CreateIndex
CREATE INDEX "League_ownerId_idx" ON "League"("ownerId");

-- CreateIndex
CREATE INDEX "League_createdAt_idx" ON "League"("createdAt");

-- CreateIndex
CREATE INDEX "League_inviteCode_idx" ON "League"("inviteCode");

-- CreateIndex
CREATE INDEX "LeagueMember_leagueId_idx" ON "LeagueMember"("leagueId");

-- CreateIndex
CREATE INDEX "LeagueMember_userId_idx" ON "LeagueMember"("userId");

-- CreateIndex
CREATE INDEX "LeagueMember_leagueId_userId_idx" ON "LeagueMember"("leagueId", "userId");

-- CreateIndex
CREATE INDEX "LeagueMember_draftSlot_idx" ON "LeagueMember"("draftSlot");

-- CreateIndex
CREATE INDEX "Pick_draftId_idx" ON "Pick"("draftId");

-- CreateIndex
CREATE INDEX "Pick_memberId_idx" ON "Pick"("memberId");

-- CreateIndex
CREATE INDEX "Pick_playerId_idx" ON "Pick"("playerId");

-- CreateIndex
CREATE INDEX "Pick_overall_idx" ON "Pick"("overall");

-- CreateIndex
CREATE INDEX "Pick_madeAt_idx" ON "Pick"("madeAt");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");
