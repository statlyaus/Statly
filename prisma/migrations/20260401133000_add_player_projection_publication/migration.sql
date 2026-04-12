CREATE TABLE "PlayerProjectionPublication" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "season" INTEGER NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'season',
  "summaryCount" INTEGER NOT NULL DEFAULT 0,
  "rankingCount" INTEGER NOT NULL DEFAULT 0,
  "rosterCount" INTEGER NOT NULL DEFAULT 0,
  "publishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "PlayerProjectionPublication_season_scope_key"
ON "PlayerProjectionPublication"("season", "scope");

CREATE INDEX "PlayerProjectionPublication_scope_season_idx"
ON "PlayerProjectionPublication"("scope", "season");

CREATE INDEX "PlayerProjectionPublication_scope_publishedAt_idx"
ON "PlayerProjectionPublication"("scope", "publishedAt");
