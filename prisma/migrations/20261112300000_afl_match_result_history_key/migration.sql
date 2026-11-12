-- A result that changes back to an earlier value (A, then B, then A) must supersede cleanly (#1295,
-- BR-24). The (season, matchId, contentHash) key refused the third row. One current row per match
-- stays enforced by the partial unique index "AflMatchResult_one_current_per_match".
-- Rollback (only while no match has a repeated hash):
--   DROP INDEX "AflMatchResult_season_matchId_idx";
--   CREATE UNIQUE INDEX "AflMatchResult_season_matchId_contentHash_key"
--     ON "AflMatchResult"("season", "matchId", "contentHash");

-- DropIndex
DROP INDEX "AflMatchResult_season_matchId_contentHash_key";

-- CreateIndex
CREATE INDEX "AflMatchResult_season_matchId_idx" ON "AflMatchResult"("season", "matchId");
