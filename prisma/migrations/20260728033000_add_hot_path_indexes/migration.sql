-- CreateIndex
CREATE INDEX "Player_active_position_name_idx" ON "Player"("active", "position", "name");

-- CreateIndex
CREATE INDEX "LeagueMatchupScore_leagueId_status_idx" ON "LeagueMatchupScore"("leagueId", "status");
