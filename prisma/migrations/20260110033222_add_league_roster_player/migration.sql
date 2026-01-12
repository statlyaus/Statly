-- RedefineIndex
DROP INDEX "LeagueRosterPlayer_unique";
CREATE UNIQUE INDEX "LeagueRosterPlayer_leagueId_memberId_playerId_key" ON "LeagueRosterPlayer"("leagueId", "memberId", "playerId");
