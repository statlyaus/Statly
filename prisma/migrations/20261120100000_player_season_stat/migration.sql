-- Per-player, per-season stat totals for /players, player search and player detail (process-map
-- finding players-data-11; owner decisions 2026-11-15 and 2026-11-18, migration approved 2026-11-18).
-- Additive: no existing row or table changes. Rollback: DROP TABLE "PlayerSeasonStat";

-- CreateTable
CREATE TABLE "PlayerSeasonStat" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "club" TEXT NOT NULL,
    "games" INTEGER NOT NULL,
    "lastRound" INTEGER NOT NULL,
    "totalsJson" JSONB NOT NULL,
    "gamesByStatJson" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerSeasonStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlayerSeasonStat_season_idx" ON "PlayerSeasonStat"("season");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerSeasonStat_playerId_season_key" ON "PlayerSeasonStat"("playerId", "season");

-- AddForeignKey
ALTER TABLE "PlayerSeasonStat" ADD CONSTRAINT "PlayerSeasonStat_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

