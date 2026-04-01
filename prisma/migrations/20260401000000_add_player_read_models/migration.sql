-- CreateTable
CREATE TABLE "PlayerSeasonSummary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "playerName" TEXT NOT NULL,
    "club" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "averageScore" REAL NOT NULL DEFAULT 0,
    "totalValue" REAL NOT NULL DEFAULT 0,
    "statsJson" TEXT NOT NULL,
    "totalsJson" TEXT NOT NULL,
    "sourceUpdatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlayerSeasonSummary_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlayerRankingSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "season" INTEGER NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'season',
    "rank" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "club" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "averageScore" REAL NOT NULL DEFAULT 0,
    "totalValue" REAL NOT NULL DEFAULT 0,
    "categoriesJson" TEXT NOT NULL,
    "statsJson" TEXT NOT NULL,
    "totalsJson" TEXT NOT NULL,
    "snapshotAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlayerRankingSnapshot_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeagueRosterPlayerSummary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "playerName" TEXT NOT NULL,
    "club" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "ownership" INTEGER NOT NULL DEFAULT 0,
    "isCaptain" BOOLEAN NOT NULL DEFAULT false,
    "isViceCaptain" BOOLEAN NOT NULL DEFAULT false,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "averageScore" REAL NOT NULL DEFAULT 0,
    "totalValue" REAL NOT NULL DEFAULT 0,
    "price" INTEGER NOT NULL DEFAULT 0,
    "lastGameScore" REAL NOT NULL DEFAULT 0,
    "projectedScore" REAL NOT NULL DEFAULT 0,
    "formJson" TEXT NOT NULL,
    "statsJson" TEXT NOT NULL,
    "totalsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LeagueRosterPlayerSummary_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueRosterPlayerSummary_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueRosterPlayerSummary_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PlayerSeasonSummary_playerId_season_key" ON "PlayerSeasonSummary"("playerId", "season");
CREATE INDEX "PlayerSeasonSummary_season_idx" ON "PlayerSeasonSummary"("season");
CREATE INDEX "PlayerSeasonSummary_season_totalValue_idx" ON "PlayerSeasonSummary"("season", "totalValue");
CREATE INDEX "PlayerSeasonSummary_season_club_idx" ON "PlayerSeasonSummary"("season", "club");
CREATE INDEX "PlayerSeasonSummary_season_position_idx" ON "PlayerSeasonSummary"("season", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerRankingSnapshot_season_scope_rank_key" ON "PlayerRankingSnapshot"("season", "scope", "rank");
CREATE UNIQUE INDEX "PlayerRankingSnapshot_season_scope_playerId_key" ON "PlayerRankingSnapshot"("season", "scope", "playerId");
CREATE INDEX "PlayerRankingSnapshot_season_scope_totalValue_idx" ON "PlayerRankingSnapshot"("season", "scope", "totalValue");
CREATE INDEX "PlayerRankingSnapshot_season_scope_playerId_idx" ON "PlayerRankingSnapshot"("season", "scope", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueRosterPlayerSummary_leagueId_memberId_playerId_season_key" ON "LeagueRosterPlayerSummary"("leagueId", "memberId", "playerId", "season");
CREATE INDEX "LeagueRosterPlayerSummary_leagueId_memberId_season_sortOrder_idx" ON "LeagueRosterPlayerSummary"("leagueId", "memberId", "season", "sortOrder");
CREATE INDEX "LeagueRosterPlayerSummary_leagueId_season_playerId_idx" ON "LeagueRosterPlayerSummary"("leagueId", "season", "playerId");
CREATE INDEX "LeagueRosterPlayerSummary_memberId_season_idx" ON "LeagueRosterPlayerSummary"("memberId", "season");

-- CreateIndex
CREATE INDEX "Player_club_idx" ON "Player"("club");
CREATE INDEX "Player_position_idx" ON "Player"("position");
CREATE INDEX "Player_active_idx" ON "Player"("active");
