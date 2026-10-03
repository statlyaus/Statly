-- Add league matchup scoring settings
ALTER TABLE "LeagueSettings" ADD COLUMN "scoringMode" TEXT NOT NULL DEFAULT 'H2H_EACH_CATEGORY';
ALTER TABLE "LeagueSettings" ADD COLUMN "lineupSlotsJson" TEXT;
ALTER TABLE "LeagueSettings" ADD COLUMN "categoryDirectionsJson" TEXT;
ALTER TABLE "LeagueSettings" ADD COLUMN "scoringSettingsLockedAt" DATETIME;

-- CreateTable
CREATE TABLE "LeagueMatchup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "homeMemberId" TEXT,
    "awayMemberId" TEXT,
    "byeMemberId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "finalizedAt" DATETIME,
    "winnerMemberId" TEXT,
    "homeCategoryWins" INTEGER NOT NULL DEFAULT 0,
    "awayCategoryWins" INTEGER NOT NULL DEFAULT 0,
    "drawnCategories" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LeagueMatchup_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueMatchup_homeMemberId_fkey" FOREIGN KEY ("homeMemberId") REFERENCES "LeagueMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LeagueMatchup_awayMemberId_fkey" FOREIGN KEY ("awayMemberId") REFERENCES "LeagueMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LeagueMatchup_byeMemberId_fkey" FOREIGN KEY ("byeMemberId") REFERENCES "LeagueMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LeagueMatchup_winnerMemberId_fkey" FOREIGN KEY ("winnerMemberId") REFERENCES "LeagueMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeagueLineup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "lockedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LeagueLineup_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueLineup_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeagueLineupPlayer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lineupId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "lockedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LeagueLineupPlayer_lineupId_fkey" FOREIGN KEY ("lineupId") REFERENCES "LeagueLineup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueLineupPlayer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeagueMatchupScore" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "matchupId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "categoriesJson" TEXT NOT NULL,
    "categoryWins" INTEGER NOT NULL DEFAULT 0,
    "categoryLosses" INTEGER NOT NULL DEFAULT 0,
    "categoryDraws" INTEGER NOT NULL DEFAULT 0,
    "pointsFor" REAL NOT NULL DEFAULT 0,
    "pointsAgainst" REAL NOT NULL DEFAULT 0,
    "matchupWin" BOOLEAN NOT NULL DEFAULT false,
    "matchupLoss" BOOLEAN NOT NULL DEFAULT false,
    "matchupDraw" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "calculatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" DATETIME,
    CONSTRAINT "LeagueMatchupScore_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueMatchupScore_matchupId_fkey" FOREIGN KEY ("matchupId") REFERENCES "LeagueMatchup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueMatchupScore_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeagueStanding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "categoryWins" INTEGER NOT NULL DEFAULT 0,
    "categoryLosses" INTEGER NOT NULL DEFAULT 0,
    "categoryDraws" INTEGER NOT NULL DEFAULT 0,
    "pointsFor" REAL NOT NULL DEFAULT 0,
    "pointsAgainst" REAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LeagueStanding_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueStanding_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "LeagueMatchup_leagueId_round_homeMemberId_awayMemberId_key" ON "LeagueMatchup"("leagueId", "round", "homeMemberId", "awayMemberId");
CREATE INDEX "LeagueMatchup_leagueId_round_idx" ON "LeagueMatchup"("leagueId", "round");
CREATE INDEX "LeagueMatchup_leagueId_status_idx" ON "LeagueMatchup"("leagueId", "status");
CREATE INDEX "LeagueMatchup_homeMemberId_idx" ON "LeagueMatchup"("homeMemberId");
CREATE INDEX "LeagueMatchup_awayMemberId_idx" ON "LeagueMatchup"("awayMemberId");
CREATE INDEX "LeagueMatchup_byeMemberId_idx" ON "LeagueMatchup"("byeMemberId");
CREATE UNIQUE INDEX "LeagueLineup_leagueId_memberId_round_key" ON "LeagueLineup"("leagueId", "memberId", "round");
CREATE INDEX "LeagueLineup_leagueId_round_idx" ON "LeagueLineup"("leagueId", "round");
CREATE INDEX "LeagueLineup_memberId_idx" ON "LeagueLineup"("memberId");
CREATE UNIQUE INDEX "LeagueLineupPlayer_lineupId_slot_slotIndex_key" ON "LeagueLineupPlayer"("lineupId", "slot", "slotIndex");
CREATE UNIQUE INDEX "LeagueLineupPlayer_lineupId_playerId_key" ON "LeagueLineupPlayer"("lineupId", "playerId");
CREATE INDEX "LeagueLineupPlayer_playerId_idx" ON "LeagueLineupPlayer"("playerId");
CREATE UNIQUE INDEX "LeagueMatchupScore_matchupId_memberId_key" ON "LeagueMatchupScore"("matchupId", "memberId");
CREATE INDEX "LeagueMatchupScore_leagueId_round_idx" ON "LeagueMatchupScore"("leagueId", "round");
CREATE INDEX "LeagueMatchupScore_memberId_idx" ON "LeagueMatchupScore"("memberId");
CREATE UNIQUE INDEX "LeagueStanding_leagueId_memberId_key" ON "LeagueStanding"("leagueId", "memberId");
CREATE INDEX "LeagueStanding_leagueId_idx" ON "LeagueStanding"("leagueId");
CREATE INDEX "LeagueStanding_memberId_idx" ON "LeagueStanding"("memberId");
