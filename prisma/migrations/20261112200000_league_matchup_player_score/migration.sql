-- No Losers per-player score breakdown (#1294, epic #1290 BR-21). LeagueMatchupScore.categoriesJson
-- holds team totals only; this table keeps each counted player's multiplier, raw and counted totals and
-- the AflMatchResult row used. Additive: no existing table changes.
-- Rollback: DROP TABLE "LeagueMatchupPlayerScore";

-- CreateTable
CREATE TABLE "LeagueMatchupPlayerScore" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "matchupId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "slot" "LeagueLineupSlot" NOT NULL,
    "outcome" TEXT NOT NULL,
    "clubResult" TEXT,
    "margin" INTEGER,
    "multiplier" DOUBLE PRECISION,
    "aflMatchUid" TEXT,
    "aflMatchResultId" TEXT,
    "rawTotalsJson" JSONB NOT NULL,
    "countedTotalsJson" JSONB NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueMatchupPlayerScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeagueMatchupPlayerScore_leagueId_seasonId_round_idx" ON "LeagueMatchupPlayerScore"("leagueId", "seasonId", "round");

-- CreateIndex
CREATE INDEX "LeagueMatchupPlayerScore_aflMatchResultId_idx" ON "LeagueMatchupPlayerScore"("aflMatchResultId");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueMatchupPlayerScore_matchupId_memberId_playerId_key" ON "LeagueMatchupPlayerScore"("matchupId", "memberId", "playerId");

-- AddForeignKey
ALTER TABLE "LeagueMatchupPlayerScore" ADD CONSTRAINT "LeagueMatchupPlayerScore_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMatchupPlayerScore" ADD CONSTRAINT "LeagueMatchupPlayerScore_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "LeagueSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMatchupPlayerScore" ADD CONSTRAINT "LeagueMatchupPlayerScore_matchupId_fkey" FOREIGN KEY ("matchupId") REFERENCES "LeagueMatchup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueMatchupPlayerScore" ADD CONSTRAINT "LeagueMatchupPlayerScore_aflMatchResultId_fkey" FOREIGN KEY ("aflMatchResultId") REFERENCES "AflMatchResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

