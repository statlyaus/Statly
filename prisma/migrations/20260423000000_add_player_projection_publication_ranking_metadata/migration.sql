ALTER TABLE "PlayerProjectionPublication"
ADD COLUMN "rankingMethod" TEXT NOT NULL DEFAULT 'weighted_score_legacy';

ALTER TABLE "PlayerProjectionPublication"
ADD COLUMN "rankingMethodVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "PlayerProjectionPublication"
ADD COLUMN "rankingMinimumGames" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "PlayerProjectionPublication"
ADD COLUMN "rankingPopulationSize" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "PlayerProjectionPublication"
ADD COLUMN "rankingsDirty" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PlayerProjectionPublication"
ADD COLUMN "rankingPublishedAt" DATETIME;

ALTER TABLE "PlayerProjectionPublication"
ADD COLUMN "rankingMetadataJson" TEXT;

ALTER TABLE "PlayerProjectionPublication"
ADD COLUMN "rostersDirty" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PlayerProjectionPublication"
ADD COLUMN "rosterPublishedAt" DATETIME;
