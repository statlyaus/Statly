-- Season scope, matchup scores and standings (contract step). Their readers and writers now carry
-- the league's active season, so "seasonId" becomes required and a member has one ladder row per
-- season.

-- Rows written between the expand migration and this one get the league's active season.
UPDATE "LeagueMatchupScore" AS t SET "seasonId" = l."activeSeasonId"
FROM "League" AS l WHERE l."id" = t."leagueId" AND t."seasonId" IS NULL;

UPDATE "LeagueStanding" AS t SET "seasonId" = l."activeSeasonId"
FROM "League" AS l WHERE l."id" = t."leagueId" AND t."seasonId" IS NULL;

DO $$
DECLARE
  missing_scores TEXT[];
  missing_standings TEXT[];
BEGIN
  SELECT array_agg("id" ORDER BY "id") INTO missing_scores
  FROM "LeagueMatchupScore" WHERE "seasonId" IS NULL;
  SELECT array_agg("id" ORDER BY "id") INTO missing_standings
  FROM "LeagueStanding" WHERE "seasonId" IS NULL;
  IF missing_scores IS NOT NULL OR missing_standings IS NOT NULL THEN
    RAISE EXCEPTION 'Rows with no season (league has no active season): LeagueMatchupScore %, LeagueStanding %',
      missing_scores, missing_standings;
  END IF;
END $$;

-- DropIndex
DROP INDEX "LeagueMatchupScore_leagueId_round_idx";

-- DropIndex
DROP INDEX "LeagueStanding_leagueId_idx";

-- DropIndex
DROP INDEX "LeagueStanding_leagueId_memberId_key";

-- DropIndex
DROP INDEX "LeagueStanding_leagueId_seasonId_idx";

-- AlterTable
ALTER TABLE "LeagueMatchupScore" ALTER COLUMN "seasonId" SET NOT NULL;

-- AlterTable
ALTER TABLE "LeagueStanding" ALTER COLUMN "seasonId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "LeagueStanding_leagueId_seasonId_memberId_key" ON "LeagueStanding"("leagueId", "seasonId", "memberId");
