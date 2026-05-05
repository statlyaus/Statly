ALTER TABLE "PlayerRankingSnapshot"
ADD COLUMN "method" TEXT NOT NULL DEFAULT 'weighted_score_legacy';

ALTER TABLE "PlayerRankingSnapshot"
ADD COLUMN "methodVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "PlayerRankingSnapshot"
ADD COLUMN "rankingValue" REAL NOT NULL DEFAULT 0;

ALTER TABLE "PlayerRankingSnapshot"
ADD COLUMN "minimumGames" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "PlayerRankingSnapshot"
ADD COLUMN "populationSize" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "PlayerRankingSnapshot"
ADD COLUMN "isSmallSample" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PlayerRankingSnapshot"
ADD COLUMN "metadataJson" TEXT;

DROP INDEX IF EXISTS "PlayerRankingSnapshot_season_scope_rank_key";
DROP INDEX IF EXISTS "PlayerRankingSnapshot_season_scope_playerId_key";
DROP INDEX IF EXISTS "PlayerRankingSnapshot_season_scope_totalValue_idx";
DROP INDEX IF EXISTS "PlayerRankingSnapshot_season_scope_playerId_idx";

CREATE UNIQUE INDEX "PlayerRankingSnapshot_season_scope_method_methodVersion_rank_key"
ON "PlayerRankingSnapshot"("season", "scope", "method", "methodVersion", "rank");

CREATE UNIQUE INDEX "PlayerRankingSnapshot_season_scope_method_methodVersion_playerId_key"
ON "PlayerRankingSnapshot"("season", "scope", "method", "methodVersion", "playerId");

CREATE INDEX "PlayerRankingSnapshot_season_scope_method_methodVersion_rankingValue_idx"
ON "PlayerRankingSnapshot"("season", "scope", "method", "methodVersion", "rankingValue");

CREATE INDEX "PlayerRankingSnapshot_season_scope_method_methodVersion_playerId_idx"
ON "PlayerRankingSnapshot"("season", "scope", "method", "methodVersion", "playerId");
