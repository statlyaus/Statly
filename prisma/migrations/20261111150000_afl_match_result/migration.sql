-- Official AFL match results for the No Losers format (#1292, epic #1290). Season-scoped shared data
-- written by the ETL (etl/resultIngest.ts). Additive: no existing table changes.
-- Rollback: DROP TABLE "AflMatchResult"; DROP TYPE "AflMatchResultStatus";

-- CreateEnum
CREATE TYPE "AflMatchResultStatus" AS ENUM ('FINAL', 'ABANDONED');

-- CreateTable
CREATE TABLE "AflMatchResult" (
    "id" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "matchId" TEXT NOT NULL,
    "matchUid" TEXT NOT NULL,
    "homeClub" TEXT NOT NULL,
    "awayClub" TEXT NOT NULL,
    "homePoints" INTEGER,
    "awayPoints" INTEGER,
    "margin" INTEGER,
    "status" "AflMatchResultStatus" NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "contentHash" TEXT NOT NULL,
    "supersededById" TEXT,
    "supersedeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AflMatchResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AflMatchResult_supersededById_key" ON "AflMatchResult"("supersededById");

-- CreateIndex
CREATE INDEX "AflMatchResult_season_round_idx" ON "AflMatchResult"("season", "round");

-- CreateIndex
CREATE INDEX "AflMatchResult_season_matchUid_idx" ON "AflMatchResult"("season", "matchUid");

-- CreateIndex
CREATE UNIQUE INDEX "AflMatchResult_season_matchId_contentHash_key" ON "AflMatchResult"("season", "matchId", "contentHash");

-- AddForeignKey
ALTER TABLE "AflMatchResult" ADD CONSTRAINT "AflMatchResult_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "AflMatchResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A match has exactly one current result: the row nothing has superseded.
CREATE UNIQUE INDEX "AflMatchResult_one_current_per_match" ON "AflMatchResult"("season", "matchId") WHERE "supersededById" IS NULL;

-- A FINAL result has both scores and the margin they imply; an ABANDONED one has none.
ALTER TABLE "AflMatchResult" ADD CONSTRAINT "AflMatchResult_score_matches_status" CHECK (
  ("status" = 'FINAL' AND "homePoints" IS NOT NULL AND "awayPoints" IS NOT NULL
    AND "homePoints" >= 0 AND "awayPoints" >= 0 AND "margin" = "homePoints" - "awayPoints")
  OR ("status" = 'ABANDONED' AND "homePoints" IS NULL AND "awayPoints" IS NULL AND "margin" IS NULL)
);

-- A superseded row names its replacement and why; a current row has neither.
ALTER TABLE "AflMatchResult" ADD CONSTRAINT "AflMatchResult_supersede_has_reason" CHECK (
  ("supersededById" IS NULL) = ("supersedeReason" IS NULL)
);

-- Superseding marks the old row first (it must stop being current before the new row is inserted,
-- or the partial index above refuses the insert), so the reference to the not-yet-inserted row is
-- checked at commit.
ALTER TABLE "AflMatchResult" ALTER CONSTRAINT "AflMatchResult_supersededById_fkey" DEFERRABLE INITIALLY DEFERRED;
