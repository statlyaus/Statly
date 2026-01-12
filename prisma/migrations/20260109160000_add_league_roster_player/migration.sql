-- CreateTable
CREATE TABLE "LeagueRosterPlayer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LeagueRosterPlayer_league_fk" FOREIGN KEY ("leagueId") REFERENCES "League" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueRosterPlayer_member_fk" FOREIGN KEY ("memberId") REFERENCES "LeagueMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueRosterPlayer_player_fk" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "LeagueRosterPlayer_unique" ON "LeagueRosterPlayer"("leagueId", "memberId", "playerId");

-- CreateIndex
CREATE INDEX "LeagueRosterPlayer_leagueId_idx" ON "LeagueRosterPlayer"("leagueId");

-- CreateIndex
CREATE INDEX "LeagueRosterPlayer_memberId_idx" ON "LeagueRosterPlayer"("memberId");

-- CreateIndex
CREATE INDEX "LeagueRosterPlayer_playerId_idx" ON "LeagueRosterPlayer"("playerId");
