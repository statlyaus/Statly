-- Season scope, lineups (contract step). Lineup readers and writers now carry the league's active
-- season, so "seasonId" becomes required and the one-lineup-per-round key includes the season.

-- Rows written between the expand migration and this one get the league's active season.
UPDATE "LeagueLineup" AS t SET "seasonId" = l."activeSeasonId"
FROM "League" AS l WHERE l."id" = t."leagueId" AND t."seasonId" IS NULL;

DO $$
DECLARE
  missing TEXT[];
BEGIN
  SELECT array_agg("id" ORDER BY "id") INTO missing FROM "LeagueLineup" WHERE "seasonId" IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'LeagueLineup rows with no season (league has no active season): %', missing;
  END IF;
END $$;

-- DropIndex
DROP INDEX "LeagueLineup_leagueId_memberId_round_key";

-- DropIndex
DROP INDEX "LeagueLineup_leagueId_round_idx";

-- AlterTable
ALTER TABLE "LeagueLineup" ALTER COLUMN "seasonId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "LeagueLineup_leagueId_seasonId_memberId_round_key" ON "LeagueLineup"("leagueId", "seasonId", "memberId", "round");
